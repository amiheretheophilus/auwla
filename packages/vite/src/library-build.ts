import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { build, loadConfigFromFile, type Plugin } from 'vite';
import { experimentalFinalizePackage, type ExperimentalCompiledPackage } from '@memoized-dom/compiler';
import type { LibraryConfig } from './library-config';
import { inside, libraryError, libraryLayout, publishingManifest, sourceFile } from './library-layout';
import { compileLibraryGraph, isLocalLibraryImport } from './library-graph';
import { emitLibraryDeclarations, rebaseLibraryMap } from './library-declarations';
import { resolvableFile } from './graph/package-artifacts';

export async function buildLibrary(options: { root?: string; config?: string } = {}): Promise<string> {
  const root = await realpath(resolve(options.root ?? process.cwd()));
  const file = resolve(root, options.config ?? '.lib.config.ts');
  if (!existsSync(file)) libraryError(`missing '${file}'; create .lib.config.ts with export default { entry: './src/index.ts' }`);
  // The config is TS/ESM regardless of the project's own package.json type.
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, file, root, undefined, undefined, 'runner');
  if (!loaded) libraryError(`could not load '${file}'`);
  const config = loaded.config as unknown as LibraryConfig;
  const { entries, outDir } = await libraryLayout(root, config);
  if (inside(outDir, file) || inside(outDir, join(root, 'package.json'))) libraryError('outDir cannot contain the library configuration or source manifest');
  const manifest = await publishingManifest(root, config, entries);
  // Packing a generated directory must not depend on workspace-only protocols.
  for (const group of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const values = manifest[group];
    if (!values || typeof values !== 'object') continue;
    for (const [name, range] of Object.entries(values)) {
      if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;
      const suffix = range.slice('workspace:'.length);
      if (!['*', '^', '~'].includes(suffix)) {
        if (/^[~^]?\d/.test(suffix)) { (values as Record<string, unknown>)[name] = suffix; continue; }
        libraryError(`unsupported workspace range '${range}' for '${name}'; use workspace:*, workspace:^, or an explicit version range`);
      }
      const entry = resolvableFile(name, name, join(root, 'package.json'));
      if (!entry) libraryError(`cannot resolve workspace dependency '${name}' to determine its published version`);
      let directory = dirname(await realpath(entry));
      while (!existsSync(join(directory, 'package.json')) && dirname(directory) !== directory) directory = dirname(directory);
      const dependency = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { version?: unknown };
      if (typeof dependency.version !== 'string') libraryError(`workspace dependency '${name}' has no version`);
      (values as Record<string, unknown>)[name] = (suffix === '*' ? '' : suffix) + dependency.version;
    }
  }
  await mkdir(join(root, '.memoized'), { recursive: true });
  if (await realpath(join(root, '.memoized')) !== join(root, '.memoized')) libraryError('.memoized staging directory cannot be a symbolic link');
  const stage = await mkdtemp(join(root, '.memoized/library-'));
  if (!inside(root, await realpath(stage))) libraryError('staging directory resolves outside the package');
  const output = join(stage, 'output');
  let compiled: ExperimentalCompiledPackage | undefined;
  let files = new Map<string, string>(), localImports = new Set<string>(), collecting = false;
  const styles = new Map<string, string>();
  const frameworkPeers = new Set<string>();
  let cleanStage = true;
  const plugin: Plugin = {
    name: 'memoized-dom:library-compiler', enforce: 'pre',
    async buildStart() {
      collecting = true;
      try {
        const graph = await compileLibraryGraph(this, root, config, entries, String(manifest.name));
        if ([...graph.files.keys()].some(file => inside(outDir, file))) libraryError('outDir overlaps an imported source module');
        compiled = graph.compiled; files = graph.files; localImports = graph.localImports;
      } finally { collecting = false; }
    },
    resolveId(id) { if (styles.has(id)) return id; return null; },
    load(id) {
      if (styles.has(id)) return styles.get(id);
      const file = id.replace(/[?#].*$/, '');
      const module = files.get(file.replaceAll('\\', '/'));
      if (module === undefined) {
        if (isAbsolute(file) && inside(root, file) && !/(?:^|[/\\])node_modules[/\\]/.test(relative(root, file)) && sourceFile(file)) libraryError(`source '${file}' was not in the compiled library graph`);
        return null;
      }
      const code = compiled!.output[module], map = compiled!.maps[module];
      const css = compiled!.css?.[module];
      const style = `\0memoized-dom:library-css:${module}.css`;
      if (css) styles.set(style, css);
      return { code: (code ?? '') + (css ? `\nimport ${JSON.stringify(style)};` : ''),
        map: map ? { ...map, sources: map.sources.map(source => resolve(root, source)) } : null };
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) if (file.type === 'chunk') {
        for (const specifier of [...file.imports, ...file.dynamicImports]) {
          const framework = specifier.match(/^(@memoized-dom\/(?:runtime|data|router))(?:\/|$)/)?.[1];
          if (framework) frameworkPeers.add(framework);
        }
      }
    },
  };
  try {
    await build({ root, configFile: false, publicDir: false, plugins: [plugin],
      resolve: { alias: config.aliases && Object.fromEntries(Object.entries(config.aliases).map(([name, path]) => [name, path.startsWith('.') ? resolve(root, path) : path])), tsconfigPaths: true },
      build: {
        outDir: output, emptyOutDir: false, minify: config.minify ?? true, sourcemap: config.sourcemap ?? false,
        target: 'es2022', lib: { entry: Object.fromEntries(entries.map(entry => [entry.output, entry.file])), formats: ['es'], fileName: (_format, name) => name + '.js', cssFileName: 'style' },
        rolldownOptions: { external: (id, importer) => !collecting && (isBuiltin(id) || !id.startsWith('.') && !isAbsolute(id) && !id.startsWith('\0') && !isLocalLibraryImport(localImports, id, importer)),
          output: { chunkFileNames: 'chunks/[name]-[hash].js' } },
      },
    });
    if (!compiled) libraryError('the compiler did not produce a library artifact');
    await emitLibraryDeclarations(root, output, config, entries);
    // Generated imports must also work in strict, non-hoisted installations.
    // Explicit author ranges win; ABI checks remain the compatibility gate.
    for (const peer of frameworkPeers) {
      if ([manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies].some(group => group && typeof group === 'object' && Object.hasOwn(group, peer))) continue;
      manifest.peerDependencies = { ...(manifest.peerDependencies as Record<string, string> | undefined), [peer]: '*' };
    }
    if (existsSync(join(output, 'style.css'))) {
      if (Object.hasOwn(manifest.exports as object, './style.css')) libraryError("public path conflict './style.css' with the generated stylesheet");
      (manifest.exports as Record<string, unknown>)['./style.css'] = './style.css';
      if (manifest.sideEffects === false) manifest.sideEffects = ['./style.css'];
    }
    await writeFile(join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const name of ['README.md', 'LICENSE', 'LICENSE.md', 'LICENCE']) if (existsSync(join(root, name))) {
      if (!inside(root, await realpath(join(root, name)))) libraryError(`'${name}' resolves outside the package`);
      await copyFile(join(root, name), join(output, name));
    }
    const maps = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) await maps(file);
        else if (entry.name.endsWith('.map')) await rebaseLibraryMap(file, join(outDir, relative(output, file)));
      }
    };
    await maps(output);
    const artifact = await experimentalFinalizePackage(compiled.artifact, { packageRoot: output, outputDirectory: '.' });
    await writeFile(join(output, 'memoized-dom.package.json'), JSON.stringify(artifact, null, 2) + '\n');
    await mkdir(dirname(outDir), { recursive: true });
    const previous = join(stage, 'previous');
    if (existsSync(outDir)) await rename(outDir, previous);
    try { await rename(output, outDir); }
    catch (error) {
      if (existsSync(previous)) {
        try { await rename(previous, outDir); }
        catch (restoreError) {
          cleanStage = false;
          throw new AggregateError([error, restoreError], `memoized-dom package: could not restore output; previous build preserved at '${previous}'`);
        }
      }
      throw error;
    }
    console.log(`Memoized DOM: packaged ${manifest.name} (${entries.length} public ${entries.length === 1 ? 'entry' : 'entries'}) → ${relative(root, outDir).split(sep).join('/')}`);
    return outDir;
  } finally {
    // Only this invocation's validated, privately created staging directory.
    if (cleanStage && inside(root, stage)) await rm(stage, { recursive: true, force: true });
  }
}
