import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { experimentalCompilePackage, experimentalFinalizePackage } from '@memoized-dom/compiler';
import { InstalledPackages, rewritePackageImports } from '../src/graph/installed-packages';
import { resolveAdapterOptions } from '../src/options';
import { compileGraph, type GraphPluginContext } from '../src/graph/collector';

let root: string, library: string, entry: string;
const watched = new Set<string>();
const options = () => resolveAdapterOptions({ clientEntry: entry, compilePackages: ['fixture-lib'] });
const manager = (environment = 'client', conditions = ['browser']) => new InstalledPackages(options(), {
  cacheDir: join(root, 'node_modules/.vite'), conditions, environment,
});
const files = async (values: Record<string, string>) => {
  for (const [file, source] of Object.entries(values)) {
    const path = join(root, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, source);
  }
};
const context: GraphPluginContext = {
  async resolve(specifier, importer) {
    try { return { id: createRequire(importer).resolve(specifier) }; } catch { return null; }
  },
  addWatchFile(file) { watched.add(file); },
  error(error): never { throw new Error(error.message); },
};
beforeEach(async () => {
  const parent = join(import.meta.dirname, 'fixtures/out'); await mkdir(parent, { recursive: true });
  root = await mkdtemp(join(parent, 'installed-')); library = join(root, 'node_modules/fixture-lib'); entry = join(root, 'App.tsx');
  watched.clear();
  await files({
    'package.json': '{"type":"module"}',
    'node_modules/fixture-lib/package.json': JSON.stringify({ name: 'fixture-lib', version: '1.0.0', type: 'module',
      exports: { '.': './index.js', './another': './another.js', './package.json': './package.json' } }),
    'node_modules/fixture-lib/index.js': `export {bump} from './helper.js';`,
    'node_modules/fixture-lib/another.js': `export {bump as increment} from './helper.js';`,
    'node_modules/fixture-lib/helper.js': `export function bump(state){state.count++;return state.count;}`,
    'App.tsx': `import {bump} from 'fixture-lib';export function App(){const state={count:0};return <button onClick={()=>bump(state)}>{state.count}</button>;}`,
  });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const compile = async (instance = manager(), specifier = 'fixture-lib', host = context) => {
  const result = await host.resolve(specifier, entry, { skipSelf: true });
  return (await instance.compile(host, result!.id, specifier, entry))!;
};

it('validates package-level opt-ins and keeps default imports opaque', async () => {
  for (const compilePackages of [['fixture-lib/another'], ['../fixture-lib'], [''], [4], 'fixture-lib']) {
    expect(() => resolveAdapterOptions({ clientEntry: entry, compilePackages } as never)).toThrow('array of package names');
  }
  expect(resolveAdapterOptions({ clientEntry: entry, compilePackages: ['fixture-lib', 'fixture-lib'] }).compilePackages).toEqual(['fixture-lib']);
  const opaque = new InstalledPackages(resolveAdapterOptions({ clientEntry: entry }), {
    cacheDir: join(root, 'cache'), conditions: [], environment: 'client',
  });
  expect(await opaque.compile(context, join(library, 'index.js'), 'fixture-lib', entry)).toBeUndefined();
  expect(existsSync(join(root, 'cache'))).toBe(false);
  const scoped = new InstalledPackages({ ...options(), compilePackages: ['@scope/package'] }, {
    cacheDir: join(root, 'cache'), conditions: [], environment: 'client',
  });
  expect(scoped.selected('@scope/package/another')).toBe(true);
  expect(scoped.selected('@scope/other')).toBe(false);
  expect(await manager().compile(context, join(library, 'package.json'), 'fixture-lib/package.json', entry)).toBeUndefined();
});

it('does not allow a cache directory inside the installed source package', async () => {
  const instance = new InstalledPackages(options(), { cacheDir: join(library, 'cache'), conditions: [], environment: 'client' });
  await expect(compile(instance)).rejects.toThrow('must be outside the installed package');
  expect(existsSync(join(library, 'cache'))).toBe(false);
});

it('compiles used package/root and explicit subpaths together without editing the installation', async () => {
  const manifest = await readFile(join(library, 'package.json'), 'utf8');
  const original = await readFile(join(library, 'helper.js'), 'utf8');
  const first = await compile();
  expect(first.cacheHit).toBe(false);
  expect(first.artifact.entries['fixture-lib']!.functions.bump!.parameterWrites).toContainEqual({ index: 0, path: ['count'] });
  expect(first.artifact.entries['fixture-lib/another']!.functions.increment).toBeDefined();
  const subpath = await compile(manager(), 'fixture-lib/another');
  expect(subpath.cacheHit).toBe(true);
  expect(dirname(subpath.resolvedFile)).toBe(dirname(first.resolvedFile));
  const { bump } = await import(pathToFileURL(first.resolvedFile).href);
  const { increment } = await import(pathToFileURL(subpath.resolvedFile).href);
  expect(bump).toBe(increment); expect(bump({ count: 0 })).toBe(1);
  expect(await readFile(join(library, 'helper.js'), 'utf8')).toBe(original);
  expect(await readFile(join(library, 'package.json'), 'utf8')).toBe(manifest);
  expect(first.dependencies).toContain(join(library, 'helper.js'));
  const map = JSON.parse(await readFile(first.resolvedFile + '.map', 'utf8'));
  expect(map.sources[0].replaceAll('\\', '/')).toBe(join(library, 'index.js').replaceAll('\\', '/'));
  expect(map.sourcesContent.join('')).toContain('bump');
  expect(watched.has(join(library, 'helper.js'))).toBe(true);
  expect((await readdir(dirname(dirname(first.resolvedFile)))).some(file => file.startsWith('.stage-'))).toBe(false);
});

it('reuses persistent output across manager instances and invalidates on source, manifest and conditions', async () => {
  const first = await compile(), originalStat = await stat(first.resolvedFile);
  const second = await compile(); expect(second.resolvedFile).toBe(first.resolvedFile); expect(second.cacheHit).toBe(true);
  expect((await stat(second.resolvedFile)).mtimeMs).toBe(originalStat.mtimeMs);
  await files({ 'node_modules/fixture-lib/helper.js': `export function bump(state){state.count+=2;return state.count;}` });
  const changed = await compile(); expect(changed.resolvedFile).not.toBe(first.resolvedFile);
  expect(changed.artifact.integrity).not.toEqual(first.artifact.integrity);
  const server = await compile(manager('ssr', ['node'])); expect(server.resolvedFile).not.toBe(changed.resolvedFile);
  const alternate = await compile(manager('client', ['custom'])); expect(alternate.resolvedFile).not.toBe(changed.resolvedFile);
  const manifest = JSON.parse(await readFile(join(library, 'package.json'), 'utf8'));
  await files({ 'node_modules/fixture-lib/package.json': JSON.stringify({ ...manifest, sideEffects: false }) });
  expect((await compile()).resolvedFile).not.toBe(changed.resolvedFile);
});

it('coalesces concurrent compilation and never reuses corrupted cached code', async () => {
  const instance = manager();
  const [first, second] = await Promise.all([compile(instance), compile(instance, 'fixture-lib/another')]);
  expect(dirname(first.resolvedFile)).toBe(dirname(second.resolvedFile));
  await writeFile(first.resolvedFile, 'export function bump(){return "tampered"}');
  await expect(compile()).rejects.toThrow('changed after finalization');
});

it('rechecks a changed transitive helper and recovers after a rejected compilation', async () => {
  const instance = manager();
  await files({ 'node_modules/fixture-lib/helper.js': 'export function bump( {' });
  await expect(compile(instance)).rejects.toThrow();
  await files({ 'node_modules/fixture-lib/helper.js': 'export function bump(state){state.count++;}' });
  expect((await compile(instance)).artifact.entries['fixture-lib']!.functions.bump).toBeDefined();
});

it('links inferred metadata and redirects executable imports to the exact finalized cache copy', async () => {
  const instance = manager();
  const graph = await compileGraph({ ...context, compilePackage: (id, specifier, importer) => instance.compile(context, id, specifier, importer) },
    root, [entry], options(), new Map(), false, false);
  const output = graph.output.get(entry.replaceAll('\\', '/'))!;
  expect(output).toContain('memoized-dom-packages');
  expect(output).not.toContain('from "fixture-lib"');
  expect(output).toContain('invalidateEntity(');
  expect(graph.semanticDependencies.has(join(library, 'helper.js').replaceAll('\\', '/'))).toBe(true);
});

it.each([
  ['commonjs', 'module.exports = {};', 'not declared ESM'],
  ['dynamic', `export async function load(){return import('./helper.js')}`, 'dynamic import/import.meta'],
  ['url identity', `export function url(){return import.meta.url}`, 'dynamic import/import.meta'],
  ['captured module state', `let count=0;export function bump(){return ++count}`, 'captures package state'],
])('rejects unsupported %s explicitly', async (_name, source, message) => {
  await files({ 'node_modules/fixture-lib/index.js': source });
  if (_name === 'commonjs') {
    const manifest = JSON.parse(await readFile(join(library, 'package.json'), 'utf8'));
    await files({ 'node_modules/fixture-lib/package.json': JSON.stringify({ ...manifest, type: 'commonjs' }) });
  }
  await expect(compile()).rejects.toThrow(message);
});

it('does not mistake an ESM parameter named module for CommonJS syntax', async () => {
  await files({ 'node_modules/fixture-lib/index.js': `export function bump(module){module.exports.count++;}` });
  const result = await compile();
  expect(result.artifact.entries['fixture-lib']!.functions.bump!.parameterWrites).toContainEqual({ index: 0, path: ['exports', 'count'] });
});

it('uses the selected environment implementation instead of another exports condition', async () => {
  await files({
    'node_modules/fixture-lib/browser.mjs': `export function bump(state){state.count=10;}`,
    'node_modules/fixture-lib/server.mjs': `export function bump(state){state.count=20;}`,
    'node_modules/fixture-lib/package.json': JSON.stringify({ name: 'fixture-lib', exports: {
      '.': { browser: './browser.mjs', node: './server.mjs' },
    } }),
  });
  const environment = (file: string): GraphPluginContext => ({ ...context, async resolve(specifier, importer, options) {
    return specifier === 'fixture-lib' ? { id: join(library, file) } : context.resolve(specifier, importer, options);
  } });
  const browser = await compile(manager(), 'fixture-lib', environment('browser.mjs'));
  const server = await compile(manager('ssr', ['node']), 'fixture-lib', environment('server.mjs'));
  expect(browser.resolvedFile).not.toBe(server.resolvedFile);
  const state = { count: 0 };
  (await import(pathToFileURL(browser.resolvedFile).href)).bump(state); expect(state.count).toBe(10);
  (await import(pathToFileURL(server.resolvedFile).href)).bump(state); expect(state.count).toBe(20);
});

it('preserves an external dependency copy relative to the original implementation', async () => {
  await files({
    'node_modules/fixture-lib/index.js': `import {change} from 'nested-dependency';export function bump(state){return change(state)}`,
    'node_modules/fixture-lib/node_modules/nested-dependency/package.json': JSON.stringify({ name: 'nested-dependency', type: 'module', exports: './index.js',
      'memoized-dom': { artifact: './artifact.json', integrity: true } }),
    'node_modules/fixture-lib/node_modules/nested-dependency/index.js': 'export function change(state){return state.count+=3}',
    'node_modules/nested-dependency/package.json': '{"name":"nested-dependency","type":"module","exports":"./index.js"}',
    'node_modules/nested-dependency/index.js': 'export function change(state){return state.count+=100}',
  });
  const dependency = join(library, 'node_modules/nested-dependency');
  const packaged = experimentalCompilePackage({ './index.js': await readFile(join(dependency, 'index.js'), 'utf8') }, {
    packageEntries: { 'nested-dependency': './index.js' },
  });
  await writeFile(join(dependency, 'index.js'), packaged.output['./index.js']!);
  await writeFile(join(dependency, 'artifact.json'), JSON.stringify(await experimentalFinalizePackage(packaged.artifact, { packageRoot: dependency, outputDirectory: '.' })));
  const result = await compile();
  expect((await import(pathToFileURL(result.resolvedFile).href)).bump({ count: 0 })).toBe(3);
  expect(result.dependencies).toContain(join(library, 'node_modules/nested-dependency/index.js'));
  await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'nested-dependency', type: 'module', exports: './index.js', sideEffects: false,
    'memoized-dom': { artifact: './artifact.json', integrity: true } }));
  await writeFile(join(dependency, 'artifact.json'), JSON.stringify(await experimentalFinalizePackage(packaged.artifact, { packageRoot: dependency, outputDirectory: '.' })));
  expect((await compile()).resolvedFile).not.toBe(result.resolvedFile);
});

it('separates two installed copies selected by their actual application importers', async () => {
  await files({
    'nested/node_modules/fixture-lib/package.json': '{"name":"fixture-lib","type":"module","exports":"./index.js"}',
    'nested/node_modules/fixture-lib/index.js': 'export function bump(state){return state.count+=5}',
  });
  const instance = manager(), outer = await compile(instance);
  const importer = join(root, 'nested/App.tsx');
  const resolution = await context.resolve('fixture-lib', importer, { skipSelf: true });
  const nested = (await instance.compile(context, resolution!.id, 'fixture-lib', importer))!;
  expect(nested.resolvedFile).not.toBe(outer.resolvedFile);
  expect((await import(pathToFileURL(nested.resolvedFile).href)).bump({ count: 0 })).toBe(5);
  expect((await import(pathToFileURL(outer.resolvedFile).href)).bump({ count: 0 })).toBe(1);
});

it('links another opted-in dependency using the implementation copy resolved from its package', async () => {
  await files({
    'node_modules/fixture-lib/index.js': `import {change} from 'nested-dependency';export function bump(state){return change(state)}`,
    'node_modules/fixture-lib/node_modules/nested-dependency/package.json': '{"name":"nested-dependency","type":"module","exports":"./index.js"}',
    'node_modules/fixture-lib/node_modules/nested-dependency/index.js': 'export function change(state){return state.count+=7}',
  });
  const instance = new InstalledPackages({ ...options(), compilePackages: ['fixture-lib', 'nested-dependency'] }, {
    cacheDir: join(root, 'node_modules/.vite'), conditions: ['browser'], environment: 'client',
  });
  const result = await compile(instance);
  expect(result.artifact.entries['fixture-lib']!.functions.bump!.parameterWrites).toContainEqual({ index: 0, path: ['count'] });
  expect((await import(pathToFileURL(result.resolvedFile).href)).bump({ count: 0 })).toBe(7);
});

it('checks the original runtime ABI even when a finalized cached entry exists', async () => {
  await files({
    'node_modules/fixture-lib/package.json': '{"name":"fixture-lib","type":"module","exports":"./index.jsx"}',
    'node_modules/fixture-lib/index.jsx': `export function Badge(){return <b>Ready</b>}`,
  });
  const runtime = join(library, 'node_modules/@memoized-dom/runtime');
  const manifest = JSON.stringify({ name: '@memoized-dom/runtime', type: 'module', exports: './index.js', 'memoized-dom': { runtimeABI: [1] } });
  await mkdir(runtime, { recursive: true }); await writeFile(join(runtime, 'package.json'), manifest);
  await writeFile(join(runtime, 'index.js'), 'export function getActiveEnvironment(){return {local:true}}');
  const first = await compile(); expect(first.artifact.compatibility?.runtime?.abi).toBe(1);
  await writeFile(join(runtime, 'package.json'), manifest.replace('[1]', '[2]'));
  await expect(compile()).rejects.toThrow('does not declare support for ABI 1');
});

it('rewrites import declarations only, not matching authored string literals', () => {
  const source = `import {bump} from 'fixture-lib';const text='fixture-lib';export {bump};`;
  const output = rewritePackageImports(source, './App.js', new Map([['fixture-lib', '/cache/index.js']]));
  expect(output.code).toContain('from "/cache/index.js"'); expect(output.code).toContain("text='fixture-lib'");
});
