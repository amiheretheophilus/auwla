import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { experimentalCompilePackage, experimentalFinalizePackage } from '@memoized-dom/compiler';
import { compileGraph, type GraphPluginContext } from '../src/graph/collector';
import { resolveAdapterOptions } from '../src/options';

let root: string, library: string, appRuntime: string, packageRuntime: string, entry: string;
let context: GraphPluginContext;
let external = false;
const watched = new Set<string>();
const writeRuntime = async (path: string, version: string, runtimeABI: unknown) => {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'index.js'), 'export const unused=true;');
  await writeFile(join(path, 'package.json'), JSON.stringify({ name: '@memoized-dom/runtime', version, type: 'module',
    exports: { '.': { import: './index.js' } }, 'memoized-dom': { runtimeABI } }));
};
const graph = (runtimePath = '@memoized-dom/runtime') => compileGraph(context, root, [entry],
  resolveAdapterOptions({ clientEntry: entry, runtimePath }), new Map(), false, false);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmd-package-compatibility-'));
  library = join(root, 'node_modules/library'); entry = join(root, 'App.tsx');
  appRuntime = join(root, 'node_modules/@memoized-dom/runtime');
  packageRuntime = join(library, 'node_modules/@memoized-dom/runtime');
  await mkdir(join(library, 'dist/chunks'), { recursive: true });
  const compiled = experimentalCompilePackage({ './index.tsx': 'export function Badge({label}:{label:string}){return <b>{label}</b>}' },
    { packageEntries: { library: './index.tsx' } });
  await writeFile(join(library, 'dist/index.js'), compiled.output['./index.tsx']!);
  await writeFile(join(library, 'dist/chunks/shared.js'), 'export const value=1;');
  await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'library', type: 'module',
    exports: './dist/index.js', 'memoized-dom': { artifact: './dist/artifact.json', integrity: true } }));
  await writeFile(join(library, 'dist/artifact.json'), JSON.stringify(await experimentalFinalizePackage(compiled.artifact, { packageRoot: library })));
  await writeFile(entry, `import {Badge} from 'library';export function App(){return <Badge label="Ready"/>}`);
  await writeRuntime(appRuntime, '7.0.0', [1]); await writeRuntime(packageRuntime, '1.5.0', [1]);
  external = false; watched.clear();
  context = {
    async resolve(specifier, importer) {
      if (specifier === 'library') return { id: external ? 'library' : join(library, 'dist/index.js'), external };
      if (specifier === '@memoized-dom/runtime') {
        if (external) return { id: specifier, external: true };
        const paths = createRequire(importer).resolve.paths(specifier) ?? [];
        const runtime = paths.find(path => path.replaceAll('\\', '/') === join(library, 'node_modules').replaceAll('\\', '/')) ? packageRuntime : appRuntime;
        return { id: join(runtime, 'index.js') };
      }
      if (specifier === 'runtime-alias') return { id: join(appRuntime, 'index.js') };
      return null;
    },
    addWatchFile(file) { watched.add(file.replaceAll('\\', '/')); },
    error(error): never { throw new Error(error.message); },
  };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('accepts different runtime versions with the same ABI and watches both resolved copies', async () => {
  const compiled = await graph();
  for (const directory of [appRuntime, packageRuntime]) {
    const manifest = join(directory, 'package.json').replaceAll('\\', '/');
    expect(compiled.semanticDependencies.has(manifest)).toBe(true);
    expect(watched.has(manifest)).toBe(true);
  }
});

it.each(['app', 'package'])('rejects an incompatible %s runtime and recovers on the next graph', async which => {
  const runtime = which === 'app' ? appRuntime : packageRuntime;
  await writeRuntime(runtime, '99.0.0', [2]);
  await expect(graph()).rejects.toThrow('does not declare support for ABI 1');
  await writeRuntime(runtime, '99.0.0', [1, 2]);
  expect((await graph()).output.size).toBe(1);
});

it('rejects missing ABI declarations and unresolved runtimes instead of assuming compatibility', async () => {
  await writeRuntime(packageRuntime, '0.0.1', undefined);
  await expect(graph()).rejects.toThrow('does not declare support for ABI 1');
  await writeRuntime(packageRuntime, '1.5.0', [1]);
  await expect(graph('unresolved-runtime')).rejects.toThrow('cannot resolve runtime');
});

it('honors runtime aliases and import-only external SSR resolution', async () => {
  expect((await graph('runtime-alias')).output.size).toBe(1);
  external = true;
  expect((await graph()).output.size).toBe(1);
});

it('checks chunk-specific runtime copies instead of only the package entry', async () => {
  const chunkRuntime = join(library, 'dist/chunks/node_modules/@memoized-dom/runtime');
  await writeRuntime(chunkRuntime, '2.0.0', [2]);
  const resolve = context.resolve;
  context.resolve = async (specifier, importer, options) => importer === join(library, 'dist/chunks/shared.js') && specifier === '@memoized-dom/runtime'
    ? { id: join(chunkRuntime, 'index.js') } : resolve(specifier, importer, options);
  await expect(graph()).rejects.toThrow(chunkRuntime);
});

it('does not substitute the default runtime for an unverifiable virtual alias', async () => {
  const resolve = context.resolve;
  context.resolve = async (specifier, importer, options) => specifier === 'runtime-alias'
    ? { id: '\0runtime-alias' } : resolve(specifier, importer, options);
  await expect(graph('runtime-alias')).rejects.toThrow('unverifiable virtual/non-file module');
});

it('inspects runtime declarations without executing runtime implementations', async () => {
  await writeFile(join(packageRuntime, 'index.js'), 'throw new Error("RUNTIME_SHOULD_NOT_EXECUTE");');
  expect((await graph()).output.size).toBe(1);
});
