/**
 * Declarations for a packaged native package (`package.ts`): one `.d.ts` per public import, so a
 * user's TypeScript sees the API without compiling the package's source.
 *
 * TypeScript's own `tsc` writes them, from the package's tsconfig (or `declarations.tsconfig`), into
 * `.types/` in the package. Each public import then gets a small file re-exporting its declarations:
 * `index.d.ts` for `.`, `entries/tabs.d.ts` for `./tabs`. Declarations only: type checking the
 * package stays the author's `bun check`.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yuku-parser';
import { libraryError, type LibraryConfig } from './library-config';
import type { PackagedEntry } from './package';

export function emitDeclarations(root: string, output: string, stage: string, config: LibraryConfig, entries: readonly PackagedEntry[]): void {
  const compiler = typeScriptCompiler(root);
  const declarations = config.declarations as boolean | { tsconfig: string } | undefined;
  const configFile = typeof declarations === 'object' ? resolve(root, declarations.tsconfig) : join(root, 'tsconfig.json');
  if (typeof declarations === 'object' && !existsSync(configFile)) libraryError(`declaration tsconfig does not exist: '${configFile}'`);
  if (entries.some((entry) => entry.file.endsWith('.tsrx'))) {
    libraryError('TSRX declaration emit is not supported; use declarations: false and provide declarations separately');
  }

  // The JSX globals (`$fetch`, intrinsic elements), so the author needs no second configuration.
  const files = entries.map((entry) => entry.file);
  const jsxTypes = findJsxTypes(root);
  if (jsxTypes !== undefined) files.push(jsxTypesReference(stage, jsxTypes));

  const typesFolder = join(output, '.types');
  const generated = join(stage, 'declarations.json');
  const hasConfig = existsSync(configFile);
  writeFileSync(generated, JSON.stringify({
    ...(hasConfig ? { extends: configFile } : { include: [], exclude: [] }),
    files,
    compilerOptions: {
      ...(hasConfig ? {} : { target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve', types: [], allowJs: true, skipLibCheck: true }),
      rootDir: root, outDir: typesFolder, declarationDir: typesFolder,
      noEmit: false, noEmitOnError: true, emitDeclarationOnly: true, declaration: true,
      declarationMap: false, sourceMap: false, inlineSourceMap: false, incremental: false, composite: false,
    },
  }));

  const emitted = runCompiler(compiler, root, ['-p', generated]);
  if (emitted.status !== 0) libraryError(`declaration emit failed:\n${emitted.stdout}${emitted.stderr}`);

  // tsc does not emit authored `.d.ts` files again. Keep them, so published declarations that
  // import or reference them still find them.
  const listed = runCompiler(compiler, root, ['-p', generated, '--listFilesOnly', '--pretty', 'false']);
  const authoredTypes: string[] = [];
  for (const line of listed.stdout.split(/\r?\n/).map((text) => text.trim())) {
    const source = resolve(root, line);
    const path = relative(root, source);
    if (line === '' || !source.endsWith('.d.ts') || path.startsWith('..') || path.split(sep).includes('node_modules')) continue;
    const target = join(typesFolder, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    authoredTypes.push(target);
  }

  for (const entry of entries) {
    const declaration = join(typesFolder, relative(root, entry.file).replace(/\.(?:tsx?|jsx?)$/, '.d.ts'));
    if (!existsSync(declaration)) libraryError(`missing declaration for '${entry.file}'`);
    const file = join(output, `${entry.output}.d.ts`);
    const target = relativeSpecifier(file, declaration).replace(/\.d\.ts$/, '.js');
    const references = authoredTypes.map((typeFile) => `/// <reference path=${JSON.stringify(relativeSpecifier(file, typeFile))} />\n`).join('');
    const defaultExport = hasDefaultExport(readFileSync(declaration, 'utf8')) ? `export { default } from ${JSON.stringify(target)};\n` : '';
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${references}export * from ${JSON.stringify(target)};\n${defaultExport}`);
  }
}

/** The package's own TypeScript: a development dependency of the package, never a global one. */
function typeScriptCompiler(root: string): string {
  const manifest = findUp(root, join('node_modules', 'typescript', 'package.json'));
  if (manifest === undefined) {
    libraryError('declarations require TypeScript in the library development dependencies; install it or set declarations: false');
  }
  return join(dirname(manifest), 'bin', 'tsc');
}

function runCompiler(compiler: string, root: string, args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  // `node` runs tsc where Node is the runtime, and Bun runs it where Bun is.
  const result = spawnSync(process.execPath, [compiler, ...args], { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? String(result.error ?? '') };
}

/**
 * The framework's JSX types (`@memoized-dom/compiler/jsx`, `src/jsx-types.ts`), from the package's
 * installation or else the compiler's own. Found under `node_modules`, so a path keeps it there.
 */
function findJsxTypes(root: string): string | undefined {
  const path = join('node_modules', '@memoized-dom', 'compiler', 'src', 'jsx-types.ts');
  return findUp(root, path) ?? findUp(dirname(createRequire(import.meta.url).resolve('yuku-parser')), path);
}

/**
 * A declaration file that imports the JSX types. They are TypeScript source, which `tsc` would
 * emit, and outside `rootDir`, if they were a file of the program. Imported from `node_modules`,
 * they are a library's, which it only reads.
 */
function jsxTypesReference(stage: string, jsxTypes: string): string {
  const file = join(stage, 'jsx-types.d.ts');
  const specifier = jsxTypes.replace(/\.ts$/, '').split(sep).join('/');
  writeFileSync(file, `import type {} from ${JSON.stringify(specifier)};\n`);
  return file;
}

/** `path` under the nearest folder from `from` upwards that has it. */
function findUp(from: string, path: string): string | undefined {
  let directory = from;
  while (true) {
    const candidate = join(directory, path);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function relativeSpecifier(from: string, to: string): string {
  const path = relative(dirname(from), to).split(sep).join('/');
  return path.startsWith('./') || path.startsWith('../') ? path : `./${path}`;
}

function hasDefaultExport(declaration: string): boolean {
  const { program } = parse(declaration, { lang: 'ts', sourceType: 'module' });
  type Statement = { type: string; specifiers?: { exported?: { name?: string; value?: string } }[] };
  return (program.body as unknown as Statement[]).some((statement) => {
    return statement.type === 'ExportDefaultDeclaration'
      || (statement.type === 'ExportNamedDeclaration' && (statement.specifiers ?? []).some((specifier) => {
        return specifier.exported?.name === 'default' || specifier.exported?.value === 'default';
      }));
  });
}
