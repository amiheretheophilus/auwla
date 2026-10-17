import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { memoizedEstreeFrontend, parseWithEstreeFrontendOrThrow } from '@memoized-dom/compiler';
import type { LibraryConfig } from './library-config';
import { inside, libraryError, type LibraryEntry } from './library-layout';
import { libraryTypePaths, relocateLibraryTypes } from './library-type-paths';

/** Declaration emit only; the user's normal typecheck remains bun check. */
export async function emitLibraryDeclarations(root: string, output: string, config: LibraryConfig, entries: readonly LibraryEntry[]): Promise<void> {
  if (config.declarations === false) return;
  const require = createRequire(join(root, 'package.json'));
  let compiler: string;
  try { compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc'); }
  catch { return libraryError('declarations require TypeScript in the library development dependencies; install it or set declarations: false'); }
  const configFile = typeof config.declarations === 'object' ? resolve(root, config.declarations.tsconfig) : join(root, 'tsconfig.json');
  if (!existsSync(configFile) && typeof config.declarations === 'object') libraryError(`declaration tsconfig does not exist: '${configFile}'`);
  if (entries.some(entry => entry.file.endsWith('.tsrx'))) libraryError('TSRX declaration emit is not supported; use declarations: false and provide declarations separately');
  const rootNames = entries.map(entry => entry.file);
  // Supply JSX globals without requiring a second authoring configuration.
  const jsxTypes = join(dirname(createRequire(import.meta.url).resolve('@memoized-dom/compiler')), 'jsx-types.d.ts');
  if (existsSync(jsxTypes)) rootNames.push(jsxTypes);
  const declarationRoot = join(output, '.types');
  const generatedConfig = join(dirname(output), 'declarations.json');
  const aliases = config.aliases ? await libraryTypePaths(root, existsSync(configFile) ? configFile : undefined, config) : undefined;
  await writeFile(generatedConfig, JSON.stringify({
    ...(existsSync(configFile) ? { extends: configFile } : { include: [], exclude: [] }), files: rootNames,
    compilerOptions: {
      ...(!existsSync(configFile) ? { target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve', types: [], allowJs: true, skipLibCheck: true } : {}),
      ...(aliases ? { paths: aliases } : {}),
      rootDir: root, outDir: declarationRoot, declarationDir: declarationRoot,
      noEmit: false, noEmitOnError: true, emitDeclarationOnly: true, declaration: true,
      declarationMap: config.sourcemap === true, sourceMap: false, inlineSourceMap: false,
      incremental: true, composite: false, tsBuildInfoFile: join(dirname(output), 'declarations.tsbuildinfo'),
    },
  }));
  try {
    await promisify(execFile)(process.execPath, [compiler, '-p', generatedConfig], { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; message?: string };
    return libraryError(`declaration emit failed:\n${result.stdout ?? ''}${result.stderr ?? result.message ?? ''}`);
  }
  // tsc does not re-emit authored .d.ts files. Preserve their module imports and
  // ambient declarations rather than publishing references to missing types.
  const listed = await promisify(execFile)(process.execPath, [compiler, '-p', generatedConfig, '--listFilesOnly', '--pretty', 'false'],
    { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const authoredTypes: string[] = [];
  for (const line of listed.stdout.split(/\r?\n/).map(line => line.trim())) {
    const source = resolve(root, line);
    if (!line || !source.endsWith('.d.ts') || !inside(root, source) || /(?:^|[/\\])node_modules[/\\]/.test(relative(root, source))) continue;
    const target = join(declarationRoot, relative(root, source));
    await mkdir(dirname(target), { recursive: true }); await copyFile(source, target); authoredTypes.push(target);
  }
  await relocateLibraryTypes(root, declarationRoot, existsSync(configFile) ? configFile : undefined, config);
  for (const entry of entries) {
    const declaration = join(declarationRoot, relative(root, entry.file).replace(/\.(?:tsx?|jsx?)$/, '.d.ts'));
    if (!existsSync(declaration)) libraryError(`missing declaration for '${entry.file}'`);
    const file = join(output, entry.output + '.d.ts');
    let path = relative(dirname(file), declaration).split(sep).join('/').replace(/\.d\.ts$/, '.js');
    if (!path.startsWith('./') && !path.startsWith('../')) path = './' + path;
    const program = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, await readFile(declaration, 'utf8'), { filename: declaration, sourceType: 'module' }).program;
    const hasDefault = program.body.some(statement => {
      const node = statement as { type: string; specifiers?: readonly { type: string; exported?: { name?: string; value?: string } }[] };
      return node.type === 'ExportDefaultDeclaration' || node.type === 'ExportNamedDeclaration' &&
        node.specifiers?.some(specifier => specifier.type === 'ExportSpecifier' && (specifier.exported?.name === 'default' || specifier.exported?.value === 'default'));
    });
    await mkdir(dirname(file), { recursive: true });
    const references = authoredTypes.map(target => {
      let path = relative(dirname(file), target).split(sep).join('/');
      if (!path.startsWith('./') && !path.startsWith('../')) path = './' + path;
      return `/// <reference path=${JSON.stringify(path)} />\n`;
    }).join('');
    await writeFile(file, `${references}export * from ${JSON.stringify(path)};\n${hasDefault ? `export { default } from ${JSON.stringify(path)};\n` : ''}`);
  }
}

/** Stage relocation must not change source-map addresses. */
export async function rebaseLibraryMap(file: string, destination: string): Promise<void> {
  const map = JSON.parse(await readFile(file, 'utf8')) as { sources?: string[]; sourceRoot?: string; sourcesContent?: (string | null)[] };
  if (!map.sources) return;
  const sources = map.sources.map(source => resolve(dirname(file), map.sourceRoot ?? '', source));
  map.sources = sources.map(source => relative(dirname(destination), source).split(sep).join('/'));
  delete map.sourceRoot;
  map.sourcesContent ??= await Promise.all(sources.map(source => readFile(source, 'utf8').catch(() => null)));
  await writeFile(file, JSON.stringify(map));
}
