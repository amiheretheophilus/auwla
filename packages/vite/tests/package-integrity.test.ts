import { afterEach, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { experimentalCompilePackage, experimentalFinalizePackage } from '@memoized-dom/compiler';
import { discoverPackageArtifact } from '../src/graph/package-artifacts';
import { compileGraph, type GraphPluginContext } from '../src/graph/collector';
import { resolveAdapterOptions } from '../src/options';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

it('verifies import-only SSR entries, watches final chunks, rejects stale graphs and recovers after rebuilding', async () => {
  root = await mkdtemp(join(tmpdir(), 'mmd-vite-integrity-'));
  const directory = join(root, 'node_modules/integrity-ui');
  const entry = join(directory, 'dist/index.js'), chunk = join(directory, 'dist/chunks/shared.js');
  const artifactFile = join(directory, 'dist/artifact.json'), app = join(root, 'App.tsx');
  await mkdir(join(directory, 'dist/chunks'), { recursive: true });
  const compiled = experimentalCompilePackage({ './index.ts': 'export function bump(state:{count:number}){state.count++;}' },
    { packageEntries: { 'integrity-ui': './index.ts' } });
  await writeFile(entry, compiled.output['./index.ts']!);
  await writeFile(chunk, 'export const value=1;');
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'integrity-ui', type: 'module',
    exports: { '.': { import: './dist/index.js' } }, 'memoized-dom': { artifact: './dist/artifact.json', integrity: true } }));
  const finalize = async () => writeFile(artifactFile, JSON.stringify(await experimentalFinalizePackage(compiled.artifact, { packageRoot: directory })));
  await finalize();
  const discovered = await discoverPackageArtifact('integrity-ui', 'integrity-ui', app);
  expect(discovered?.verifiedFiles).toHaveLength(2);
  const finalized = await readFile(artifactFile, 'utf8');
  await writeFile(artifactFile, JSON.stringify(compiled.artifact));
  await expect(discoverPackageArtifact('integrity-ui', 'integrity-ui', app)).rejects.toThrow('required integrity stamp is missing');
  await writeFile(artifactFile, finalized);
  await writeFile(app, `import {bump} from 'integrity-ui';export function App(){let state={count:0};return <button onClick={()=>bump(state)}>{state.count}</button>;}`);
  const watched = new Set<string>();
  const context: GraphPluginContext = { async resolve(specifier) { return specifier === 'integrity-ui' ? { id: entry } : null; },
    addWatchFile(path) { watched.add(path); }, error(error): never { throw new Error(error.message); } };
  const graph = () => compileGraph(context, root!, [app], resolveAdapterOptions({ clientEntry: app }), new Map(), false, false);
  expect((await graph()).semanticDependencies.has(chunk.replaceAll('\\', '/'))).toBe(true);
  expect(watched.has(chunk.replaceAll('\\', '/'))).toBe(true);
  const original = await readFile(chunk, 'utf8');
  await writeFile(chunk, original + '\n// new build');
  await expect(graph()).rejects.toThrow("'dist/chunks/shared.js' changed");
  await expect(discoverPackageArtifact('integrity-ui', 'integrity-ui', app)).rejects.toThrow('changed after finalization');
  await finalize();
  expect((await graph()).semanticDependencies.size).toBe(4);
  await writeFile(join(directory, 'dist/unsealed.js'), 'export const value=2;');
  await expect(discoverPackageArtifact(join(directory, 'dist/unsealed.js'), 'integrity-ui', app)).rejects.toThrow('is not protected');
});
