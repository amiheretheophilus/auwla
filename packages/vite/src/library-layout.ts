import { existsSync } from 'node:fs';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { LibraryConfig } from './library-config';

export const sourceFile = (path: string) => /\.(?:ts|tsx|js|jsx|tsrx)$/.test(path) && !path.endsWith('.d.ts');
export function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
export function libraryError(message: string): never { throw new Error(`memoized-dom package: ${message}`); }
export interface LibraryEntry { path: string; file: string; output: string }

export async function libraryLayout(root: string, config: LibraryConfig): Promise<{ entries: LibraryEntry[]; outDir: string }> {
  if (!config || typeof config !== 'object' || typeof config.entry !== 'string' || !config.entry) libraryError('.lib.config.ts must specify entry');
  if (config.subpaths !== undefined && (!Array.isArray(config.subpaths) || !config.subpaths.every(path => typeof path === 'string' && path))) libraryError('subpaths must be an array of directory paths');
  for (const name of ['minify', 'sourcemap', 'runtimeOwnedState'] as const) {
    if (config[name] !== undefined && typeof config[name] !== 'boolean') libraryError(`${name} must be a boolean`);
  }
  if (config.declarations !== undefined && typeof config.declarations !== 'boolean' &&
    (!config.declarations || typeof config.declarations !== 'object' || typeof config.declarations.tsconfig !== 'string')) libraryError('declarations must be a boolean or { tsconfig: string }');
  if (config.outDir !== undefined && (typeof config.outDir !== 'string' || !config.outDir)) libraryError('outDir must be a directory path');
  if (config.package !== undefined && (!config.package || typeof config.package !== 'object' || Array.isArray(config.package))) libraryError('package must be a publishing metadata object');
  if (config.aliases !== undefined && (!config.aliases || typeof config.aliases !== 'object' || Array.isArray(config.aliases) || Object.values(config.aliases).some(path => typeof path !== 'string' || !path))) libraryError('aliases must map source names to paths');
  const outDir = resolve(root, config.outDir ?? 'dist');
  if (outDir === root || !inside(root, outDir) || /^(?:node_modules|\.git|\.memoized)(?:\/|$)/.test(relative(root, outDir).split(sep).join('/'))) libraryError('outDir must be a dedicated output directory inside the package');
  let ancestor = outDir;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (!inside(root, await realpath(ancestor)) || resolve(await realpath(ancestor)) !== ancestor) libraryError('outDir or its parent cannot resolve through a symbolic link');
  // Moving a symlinked output could otherwise replace its unrelated real target.
  if (existsSync(outDir) && resolve(await realpath(outDir)) !== outDir) libraryError('outDir cannot be a symbolic link');
  const entries = new Map<string, LibraryEntry>();
  const add = async (path: string, file: string) => {
    const authored = resolve(file);
    if (inside(outDir, authored) || dirname(authored) !== root && inside(dirname(authored), outDir)) libraryError('outDir cannot overlap an authored entry path');
    const actual = await realpath(file);
    if (!inside(root, actual) || !sourceFile(actual) || inside(outDir, actual)) libraryError(`entry '${file}' must be a local source file outside outDir`);
    if (dirname(actual) !== root && inside(dirname(actual), outDir)) libraryError('outDir cannot be inside an entry source directory');
    if (/[\\\u0000-\u001f\u007f:#?*]/.test(path) || path.split('/').some(part => part === '..')) libraryError(`unsupported public path '${path}'`);
    const key = path.toLowerCase();
    const previous = entries.get(key);
    if (previous) {
      if (previous.path === path && previous.file === actual) return;
      libraryError(`public path conflict '${path}': '${previous.file}' and '${actual}'`);
    }
    entries.set(key, { path, file: actual, output: path === '.' ? 'index' : `entries/${path.slice(2)}` });
  };
  await add('.', resolve(root, config.entry));
  for (const path of config.subpaths ?? []) {
    const directory = await realpath(resolve(root, path));
    if (directory !== resolve(root, path)) libraryError(`subpaths directory '${path}' cannot be a symbolic link`);
    if (!inside(root, directory) || inside(outDir, directory) || inside(directory, outDir)) libraryError(`subpaths directory '${path}' must stay inside the package and separate from outDir`);
    const visit = async (directory: string): Promise<void> => {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) libraryError(`public directory contains a symbolic link: '${join(directory, entry.name)}'`);
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const file = join(directory, entry.name);
        if (entry.isDirectory()) { await visit(file); continue; }
        if (!entry.isFile() || !sourceFile(file)) continue;
        const name = relative(resolve(root, path), file).split(sep).join('/').replace(/\.(?:ts|tsx|js|jsx|tsrx)$/, '').replace(/(?:^|\/)index$/, '');
        await add(name ? `./${name}` : '.', file);
      }
    };
    await visit(directory);
  }
  return { entries: [...entries.values()], outDir };
}

const metadataFields = ['name', 'version', 'private', 'description', 'license', 'author', 'contributors', 'repository', 'homepage', 'bugs', 'keywords', 'funding', 'engines', 'dependencies', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies', 'publishConfig', 'sideEffects'];
export async function publishingManifest(root: string, config: LibraryConfig, entries: readonly LibraryEntry[]): Promise<Record<string, unknown>> {
  const source = existsSync(join(root, 'package.json')) ? JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, unknown> : {};
  if (config.package && Object.keys(config.package).some(field => !metadataFields.includes(field))) libraryError('config.package accepts publishing metadata, not generated exports/files/scripts/layout fields');
  const metadata = { ...source, ...config.package };
  if (typeof metadata.name !== 'string' || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(metadata.name) || typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(metadata.version)) libraryError('provide a valid package name and version in the normal package.json or config.package');
  return {
    ...Object.fromEntries(metadataFields.filter(key => metadata[key] !== undefined).map(key => [key, metadata[key]])),
    type: 'module', main: './index.js', module: './index.js',
    ...(config.declarations === false ? {} : { types: './index.d.ts' }),
    exports: Object.fromEntries(entries.map(entry => [entry.path, {
      ...(config.declarations === false ? {} : { types: `./${entry.output}.d.ts` }),
      import: `./${entry.output}.js`, default: `./${entry.output}.js`,
    }])),
    'memoized-dom': { artifact: './memoized-dom.package.json', integrity: true },
  };
}
