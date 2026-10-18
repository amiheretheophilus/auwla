/** Explicit installed-ESM compilation. Never writes into the source package. */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import MagicString from 'magic-string';
import remapping from '@jridgewell/remapping';
import {
  experimentalCompilePackage, experimentalFinalizePackage, experimentalPackageArtifactInstance,
  experimentalVerifyPackageIntegrity, memoizedEstreeFrontend, parseWithEstreeFrontendOrThrow,
  validateExperimentalPackageArtifact,
} from '@memoized-dom/compiler';
import type { ResolvedAdapterOptions } from '../options';
import { expandStars } from '../library-graph';
import { valueImports } from './imports';
import { discoverPackageArtifact, type DiscoveredPackageArtifact } from './package-artifacts';
import { verifyPackageRuntimeCompatibility } from './package-compatibility';
import type { GraphPluginContext } from './collector';

type Node = { type: string; [key: string]: unknown };
const node = (value: unknown): value is Node => !!value && typeof value === 'object' && typeof (value as Node).type === 'string';
const inside = (root: string, file: string) => {
  const path = relative(root, file); return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
};
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const identity = (importer: string, specifier: string) => importer + '\0' + specifier;
const js = (file: string) => /\.(?:mjs|jsx?)$/.test(file);
const emittedFile = (id: string) => id.endsWith('.jsx') ? id + '.js' : id;
const implementationFile = (file: string) => file.replace(/\?v=[\w-]+$/, '');
export const installedPackageName = (specifier: string) =>
  /^(?:@[\w.-]+\/)?[\w.-]+(?:\/[^?#]*)?$/.test(specifier) ? specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/') : undefined;

export interface CompiledInstalledPackage extends DiscoveredPackageArtifact {
  readonly dependencies: readonly string[];
  readonly cacheHit: boolean;
}

export interface InstalledPackageHost {
  readonly cacheDir: string;
  /** Vite's actual environment conditions; client and server never share a plan. */
  readonly conditions: readonly string[];
  readonly environment: string;
}

/** Ranges are parser-owned; do not rewrite arbitrary matching string literals. */
export function rewritePackageImports(source: string, filename: string, replacements: ReadonlyMap<string, string>) {
  const program = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, source, { filename, sourceType: 'module' }).program;
  const updated = new MagicString(source);
  for (const statement of program.body as unknown as Node[]) {
    if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(statement.type) || !node(statement.source)) continue;
    const replacement = replacements.get(String(statement.source.value));
    if (replacement === undefined) continue;
    const literal = statement.source, range = literal.range as number[] | undefined;
    const start = typeof literal.start === 'number' ? literal.start : range?.[0];
    const end = typeof literal.end === 'number' ? literal.end : range?.[1];
    if (start === undefined || end === undefined) throw new Error('memoized-dom: dependency import has no source range');
    updated.overwrite(start, end, JSON.stringify(replacement));
  }
  return { code: updated.toString(), map: updated.generateMap({ source: filename, file: filename, includeContent: true, hires: true }) };
}

/** One manager per Vite environment. Pending work is coalesced, failures evicted. */
export class InstalledPackages {
  private readonly pending = new Map<string, Promise<CompiledInstalledPackage>>();
  constructor(private readonly options: ResolvedAdapterOptions, private readonly host: InstalledPackageHost) {}

  owns(file: string): boolean { return inside(resolve(this.host.cacheDir, 'memoized-dom-packages'), file); }

  selected(specifier: string): boolean {
    const name = installedPackageName(specifier);
    return name !== undefined && this.options.compilePackages?.includes(name) === true;
  }

  async compile(context: GraphPluginContext, resolvedId: string, specifier: string, importer: string,
    ancestry: readonly string[] = []): Promise<CompiledInstalledPackage | undefined> {
    if (!this.selected(specifier)) return;
    resolvedId = implementationFile(resolvedId);
    const fail = (message: string): never => { throw new Error(`memoized-dom: cannot compile installed package '${specifier}': ${message}. Remove it from compilePackages to use ordinary opaque execution`); };
    if (/\.(?:cjs|cts)$/.test(resolvedId)) fail('CommonJS conversion is not supported yet');
    if (/\.(?:ts|tsx|tsrx)$/.test(resolvedId)) fail('installed source entries must be emitted ESM JavaScript');
    if (isAbsolute(resolvedId) && !js(resolvedId)) return; // JSON, CSS and other assets keep their ordinary Vite loaders.
    const compileOwned = async (root: string, entry: string) => {
      try { return await this.compileOwned(context, root, entry, specifier, importer, fail, ancestry); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('memoized-dom: cannot compile installed package')) throw error;
        return fail(message.includes('integrity check failed')
          ? `cached output failed integrity verification; clear the Vite dependency cache and restart. ${message}` : message);
      }
    };
    if (!isAbsolute(resolvedId) || /[?#]/.test(resolvedId)) fail('Vite must resolve an unoptimized ESM file (SSR must not externalize this package)');
    const entry = await realpath(resolvedId);
    const name = installedPackageName(specifier)!;
    let root = dirname(entry);
    while (!existsSync(join(root, 'package.json'))) {
      const parent = dirname(root); if (parent === root) fail('no owning package.json'); root = parent;
    }
    const manifestFile = join(root, 'package.json'), manifestText = await readFile(manifestFile, 'utf8');
    const manifest = JSON.parse(manifestText) as { name?: string; type?: string; exports?: unknown; 'memoized-dom'?: unknown };
    // Some packages put {type:module} next to an ESM entry. Find the named owner.
    while (manifest.name !== name) {
      const parent = dirname(root); if (parent === root) fail('resolved file does not belong to the selected package');
      root = parent;
      if (existsSync(join(root, 'package.json'))) {
        const candidate = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: string };
        if (candidate.name === name) return compileOwned(root, entry);
      }
    }
    return compileOwned(root, entry);
  }

  private async compileOwned(context: GraphPluginContext, root: string, entry: string, specifier: string, importer: string,
    fail: (message: string) => never, ancestry: readonly string[]): Promise<CompiledInstalledPackage> {
    if (ancestry.includes(root) || ancestry.length >= 32) fail('cyclic or excessively deep opted-in package dependency graph');
    const manifestFile = join(root, 'package.json'), manifestText = await readFile(manifestFile, 'utf8');
    const manifest = JSON.parse(manifestText) as { name: string; type?: string; exports?: unknown };
    const sources = new Map<string, string>(), programs = new Map<string, Node>(), files = new Map<string, string>();
    const dependencies = new Map<string, string>([[manifestFile, hash(manifestText)]]);
    const resolutions = new Map<string, string>(), external = new Map<string, Map<string, string>>();
    const artifacts: import('@memoized-dom/compiler').ExperimentalPackageImport[] = [];
    let size = 0;
    const remember = async (file: string) => {
      const text = await readFile(file, 'utf8'); dependencies.set(file, hash(text)); context.addWatchFile(file); return text;
    };
    context.addWatchFile(manifestFile);
    const visit = async (input: string): Promise<string> => {
      const file = await realpath(input);
      if (!inside(root, file) || !js(file) || relative(root, file).split(sep).includes('node_modules')) fail(`local implementation '${file}' must be ESM JavaScript inside its package`);
      const id = './' + relative(root, file).replaceAll('\\', '/');
      if (sources.has(id)) return id;
      if (sources.size >= 512) fail('implementation exceeds the 512-module limit');
      const source = await remember(file); size += Buffer.byteLength(source);
      if (size > 8 * 1024 * 1024) fail('implementation exceeds the 8 MiB source limit');
      // Check the closest type scope; .mjs is ESM regardless of package type.
      if (!file.endsWith('.mjs')) {
        let directory = dirname(file), type = manifest.type;
        while (directory !== root) {
          const scope = join(directory, 'package.json');
          if (existsSync(scope)) { type = (JSON.parse(await remember(scope)) as { type?: string }).type; break; }
          directory = dirname(directory);
        }
        if (type !== 'module') fail(`'${id}' is not declared ESM; CommonJS conversion is not supported yet`);
      }
      const program = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, source, { filename: id, sourceType: 'module' }).program as unknown as Node;
      const inspect = (value: unknown): void => {
        if (!node(value)) return;
        if (value.type === 'ImportExpression' || value.type === 'MetaProperty' && (value.meta as { name?: string })?.name === 'import')
          fail(`'${id}' uses dynamic import/import.meta; relocated module identity is not supported yet`);
        for (const [key, child] of Object.entries(value)) if (!['loc', 'range', 'start', 'end'].includes(key)) {
          if (Array.isArray(child)) child.forEach(inspect); else if (node(child)) inspect(child);
        }
      };
      inspect(program); sources.set(id, source); programs.set(id, program); files.set(id, file);
      const replacements = new Map<string, string>(); external.set(id, replacements);
      for (const reference of valueImports(program as unknown as { body: unknown[] })) {
        const result = await context.resolve(reference.specifier, file, { skipSelf: true });
        if (!result) fail(`cannot resolve '${reference.specifier}' from '${id}'`);
        const target = implementationFile(result!.id);
        if (isAbsolute(target) && inside(root, target) && !relative(root, target).split(sep).includes('node_modules')) {
          resolutions.set(identity(id, reference.specifier), await visit(target));
        } else {
          if (reference.specifier.startsWith('.') || reference.specifier.startsWith('#')) fail(`local import '${reference.specifier}' escapes the package`);
          // Bind external resolution to the original importer, not the cache directory.
          if (!isAbsolute(target) && !result!.external) fail(`dependency '${reference.specifier}' resolves to a virtual module`);
          replacements.set(reference.specifier, target.replaceAll('\\', '/'));
          if (isAbsolute(target)) await remember(target);
          const provider = await discoverPackageArtifact(target, reference.specifier, file) ??
            await this.compile(context, target, reference.specifier, file, [...ancestry, root]);
          if (provider) {
            artifacts.push({ importer: id, specifier: reference.specifier, instance: provider.instance, artifact: provider.artifact });
            for (const dependency of [provider.manifestFile, provider.artifactFile, ...provider.verifiedFiles]) await remember(dependency);
            if ('dependencies' in provider) {
              replacements.set(reference.specifier, provider.resolvedFile.replaceAll('\\', '/'));
              for (const dependency of (provider as CompiledInstalledPackage).dependencies) await remember(dependency);
            }
          }
        }
      }
      return id;
    };
    const publicEntries = new Map<string, string>();
    const add = async (publicName: string) => {
      if (publicEntries.size >= 256) fail('more than 256 public JavaScript entries');
      const result = await context.resolve(publicName, importer, { skipSelf: true });
      if (!result) { if (publicName === specifier) fail(`public entry '${publicName}' is unavailable`); return; }
      if (!isAbsolute(result.id)) fail(`public entry '${publicName}' must resolve to an ESM file`);
      const target = implementationFile(result!.id);
      if (!js(target)) return; // package.json/types/assets are not executable boundaries.
      if (!inside(root, await realpath(target))) fail(`public entry '${publicName}' resolves to a different package copy`);
      publicEntries.set(publicName, await visit(target));
    };
    // Compile all explicit public ESM entries together so subpaths share private
    // helper modules instead of creating a different store/timer copy per entry.
    const exported = manifest.exports;
    if (exported && typeof exported === 'object' && !Array.isArray(exported) && Object.keys(exported).some(key => key.startsWith('.'))) {
      for (const path of Object.keys(exported).sort()) {
        if ((exported as Record<string, unknown>)[path] === null) continue;
        if (path.includes('*')) fail('wildcard exports are not supported yet; explicit public ESM subpaths are supported');
        if (path !== '.' && !path.startsWith('./')) fail('invalid public export key');
        await add(manifest.name + (path === '.' ? '' : path.slice(1)));
      }
    } else {
      await add(manifest.name);
      if (specifier !== manifest.name) fail('legacy deep imports without an explicit exports map are not supported yet');
    }
    if (!publicEntries.has(specifier) || files.get(publicEntries.get(specifier)!) !== entry) fail(`resolved entry '${entry}' disagrees with Vite public-entry resolution '${files.get(publicEntries.get(specifier)!)}'`);
    expandStars(sources, programs, resolutions);
    const compilerFile = createRequire(import.meta.url).resolve('@memoized-dom/compiler');
    const compilerHash = hash(await readFile(compilerFile));
    const compilerDependencies: [string, string][] = [];
    let compilerRoot = dirname(compilerFile);
    while (!existsSync(join(compilerRoot, 'package.json')) && compilerRoot !== dirname(compilerRoot)) compilerRoot = dirname(compilerRoot);
    const compilerManifest = JSON.parse(await readFile(join(compilerRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    const compilerRequire = createRequire(compilerFile);
    for (const dependency of Object.keys(compilerManifest.dependencies ?? {}).sort()) {
      const file = compilerRequire.resolve(dependency);
      let directory = dirname(file);
      while (!existsSync(join(directory, 'package.json')) && directory !== dirname(directory)) directory = dirname(directory);
      compilerDependencies.push([file, hash(await readFile(file))], [join(directory, 'package.json'), hash(await readFile(join(directory, 'package.json')))]);
    }
    const hostHash = hash(await readFile(fileURLToPath(import.meta.url)));
    const runtimePath = this.options.runtimePath ?? '@memoized-dom/runtime';
    // Generated imports must retain the original module's dependency copy.
    // Include those resolutions before computing the cache key, not only while
    // writing a miss, so runtime aliases and nested installs cannot reuse it.
    for (const [id, file] of files) {
      const runtime = await context.resolve(runtimePath, file, { skipSelf: true });
      if (runtime) {
        const runtimeFile = implementationFile(runtime.id);
        external.get(id)!.set(runtimePath, runtimeFile.replaceAll('\\', '/'));
        if (isAbsolute(runtime.id)) {
          await remember(runtimeFile);
          let directory = dirname(runtimeFile);
          while (directory !== dirname(directory)) {
            if (existsSync(join(directory, 'package.json'))) { await remember(join(directory, 'package.json')); break; }
            directory = dirname(directory);
          }
        }
      }
    }
    const options = { runtimePath, routedEnvironment: this.host.environment === 'ssr' ? 'server' as const : 'client' as const,
      dataRuntimePath: this.options.dataRuntimePath, routerPath: this.options.routerPath,
      transparentAsyncSources: this.options.transparentAsyncSources, externalReactiveSources: this.options.externalReactiveSources,
      moduleStateCells: this.host.environment === 'ssr', hot: false, initialContent: false };
    const key = hash(JSON.stringify({ format: 1, compilerHash, compilerDependencies, hostHash, root, conditions: this.host.conditions,
      environment: this.host.environment, options, entries: [...publicEntries], dependencies: [...dependencies].sort(),
      resolutions: [...resolutions].sort(), external: [...external].map(([id, values]) => [id, [...values]]) }));
    const cacheRoot = resolve(this.host.cacheDir, 'memoized-dom-packages'), directory = join(cacheRoot, key);
    if (inside(root, cacheRoot)) fail('Vite cacheDir must be outside the installed package');
    const pendingKey = directory;
    let pending = this.pending.get(pendingKey);
    if (!pending) {
      pending = (async () => {
        await mkdir(cacheRoot, { recursive: true });
        if (await realpath(cacheRoot) !== cacheRoot) fail('dependency cache must not be a symbolic link');
        let cacheHit = existsSync(directory);
        if (!cacheHit) {
          const compiled = experimentalCompilePackage(Object.fromEntries(sources), {
            ...options, experimentalPackageImports: artifacts,
            resolveImport: (specifier, importer) => resolutions.get(identity(importer, specifier)),
            packageEntries: Object.fromEntries(publicEntries),
          });
          const stage = await mkdtemp(join(cacheRoot, '.stage-'));
          try {
            for (const [id, code] of Object.entries(compiled.output)) {
              const replacements = new Map(external.get(id));
              for (const reference of valueImports(parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, code, { filename: id, sourceType: 'module' }).program)) {
                const local = resolutions.get(identity(id, reference.specifier));
                if (local) replacements.set(reference.specifier, './' + relative(dirname(join(stage, emittedFile(id))), join(stage, emittedFile(local))).replaceAll('\\', '/'));
                else if (!replacements.has(reference.specifier)) {
                  const result = await context.resolve(reference.specifier, files.get(id)!, { skipSelf: true });
                  if (!result) fail(`cannot resolve generated import '${reference.specifier}'`);
                  replacements.set(reference.specifier, result!.id.replaceAll('\\', '/'));
                }
              }
              const output = join(stage, emittedFile(id)); await mkdir(dirname(output), { recursive: true });
              const rewritten = rewritePackageImports(code, id, replacements);
              const map = JSON.parse(remapping([JSON.parse(rewritten.map.toString()), compiled.maps[id]!], () => null).toString());
              map.sources = map.sources.map((source: string) => files.get(source) ?? resolve(root, source));
              await writeFile(output + '.map', JSON.stringify(map));
              await writeFile(output, rewritten.code + '\n//# sourceMappingURL=' + basename(output) + '.map\n');
            }
            await writeFile(join(stage, 'package.json'), JSON.stringify({ name: manifest.name, type: 'module',
              exports: Object.fromEntries([...publicEntries].map(([specifier, id]) =>
                [specifier === manifest.name ? '.' : './' + specifier.slice(manifest.name.length + 1), emittedFile(id)])),
              'memoized-dom': { artifact: './memoized-dom.package.json', integrity: true } }));
            const artifact = await experimentalFinalizePackage(compiled.artifact, { packageRoot: stage, outputDirectory: '.' });
            await writeFile(join(stage, 'memoized-dom.package.json'), JSON.stringify(artifact));
            // Atomic publication; another environment/process may win the same key.
            for (let attempt = 0; ; attempt++) {
              try { await rename(stage, directory); break; }
              catch (error) {
                if (existsSync(directory)) { cacheHit = true; break; }
                // Windows scanners can briefly hold a newly written directory.
                // Retry the atomic rename, never replace a published entry.
                if (process.platform !== 'win32' || attempt >= 6 ||
                    !['EPERM', 'EBUSY', 'EACCES'].includes(String((error as NodeJS.ErrnoException).code))) throw error;
                await delay(10 * 2 ** attempt);
              }
            }
          } finally { await rm(stage, { recursive: true, force: true }); }
        }
        const artifactFile = join(directory, 'memoized-dom.package.json');
        const artifact = validateExperimentalPackageArtifact(JSON.parse(await readFile(artifactFile, 'utf8')));
        const verifiedFiles = await experimentalVerifyPackageIntegrity(artifact, directory);
        const result: CompiledInstalledPackage = { artifact, instance: experimentalPackageArtifactInstance(artifact), artifactFile,
          manifestFile: join(directory, 'package.json'), verifiedFiles, resolvedFile: join(directory, emittedFile(publicEntries.get(specifier)!)),
          dependencies: [...dependencies.keys()], cacheHit };
        // Validate the runtime at original source locations, where its imports
        // were resolved, rather than pretending the cache owns those dependencies.
        await verifyPackageRuntimeCompatibility({ ...result, verifiedFiles: [...files.values()] }, importer, runtimePath, context, new Map());
        return result;
      })();
      this.pending.set(pendingKey, pending);
    }
    try {
      const result = await pending;
      return { ...result, resolvedFile: join(directory, emittedFile(publicEntries.get(specifier)!)) };
    } finally { if (this.pending.get(pendingKey) === pending) this.pending.delete(pendingKey); }
  }
}
