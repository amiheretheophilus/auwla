import { expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
  compileModules, experimentalCompilePackage, experimentalPackageArtifactInstance,
  validateExperimentalPackageArtifact,
} from '@memoized-dom/compiler';

const component = { './index.tsx': 'export function Badge({label}:{label:string}){return <b>{label}</b>}' };
const options = { packageEntries: { library: './index.tsx' } };

it('generates compiler and runtime requirements without author-written contracts', async () => {
  const { artifact } = experimentalCompilePackage(component, options);
  expect(artifact.compatibility).toEqual({ compiler: 1, runtime: { specifier: '@memoized-dom/runtime', abi: 1 } });
  const manifest = JSON.parse(await readFile(new URL('../packages/runtime/package.json', import.meta.url), 'utf8'));
  expect(manifest['memoized-dom'].runtimeABI).toContain(artifact.compatibility!.runtime!.abi);
  expect(experimentalCompilePackage(component, { ...options, runtimePath: 'custom-runtime' }).artifact.compatibility)
    .toEqual({ compiler: 1, runtime: { specifier: 'custom-runtime', abi: 1 } });
});

it('does not require a runtime ABI for an unused generated namespace import', () => {
  const { artifact } = experimentalCompilePackage({ './index.ts': 'export function bump(s:{count:number}){s.count++}' },
    { packageEntries: { library: './index.ts' } });
  expect(artifact.compatibility).toEqual({ compiler: 1 });
});

it('retains runtime requirements for runtime-using helpers and side-effect imports', () => {
  const { artifact } = experimentalCompilePackage({ './index.ts': `
    import {getActiveEnvironment} from '@memoized-dom/runtime';
    export function documentFor(){return getActiveEnvironment().document;}` },
    { packageEntries: { library: { moduleId: './index.ts', runtimeOwnedState: true } } });
  expect(artifact.compatibility?.runtime).toEqual({ specifier: '@memoized-dom/runtime', abi: 1 });
  const sideEffect = experimentalCompilePackage({ './index.ts': `import '@memoized-dom/runtime/hydrate';export function identity(n:number){return n}` },
    { packageEntries: { library: './index.ts' } });
  expect(sideEffect.artifact.compatibility?.runtime?.abi).toBe(1);
  const namespace = experimentalCompilePackage({ './index.ts': `import * as runtime from '@memoized-dom/runtime';export function runtimeFor(){return runtime;}` },
    { packageEntries: { library: { moduleId: './index.ts', runtimeOwnedState: true } } });
  expect(namespace.artifact.compatibility?.runtime?.abi).toBe(1);
});

it.each([
  [{ compiler: 2 }, 'unsupported compiler contract 2'],
  [{ compiler: 1, runtime: { specifier: 'runtime', abi: 2 } }, 'unsupported runtime ABI 2'],
  [{ compiler: 1, runtime: { specifier: '', abi: 1 } }, 'runtime.specifier'],
  [{ compiler: 1, runtime: { specifier: 'runtime', abi: 0 } }, 'runtime.abi'],
])('rejects incompatible or malformed contracts before linking (%j)', (compatibility, message) => {
  const original = experimentalCompilePackage(component, options).artifact;
  const artifact = { ...original, compatibility };
  expect(() => validateExperimentalPackageArtifact(artifact)).toThrow(message);
  expect(() => compileModules({ './app.tsx': `import {Badge} from 'library';export function App(){return <Badge label="x"/>}` },
    { experimentalPackageArtifacts: [artifact as typeof original] })).toThrow(message);
});

it('preserves older artifacts while binding compatibility into semantic identity', () => {
  const artifact = experimentalCompilePackage(component, options).artifact;
  const { compatibility: _compatibility, ...legacy } = artifact;
  expect(validateExperimentalPackageArtifact(legacy).compatibility).toBeUndefined();
  expect(experimentalPackageArtifactInstance(legacy)).not.toBe(experimentalPackageArtifactInstance(artifact));
  expect(experimentalPackageArtifactInstance({ ...artifact, compatibility: { runtime: { abi: 1, specifier: '@memoized-dom/runtime' }, compiler: 1 } }))
    .toBe(experimentalPackageArtifactInstance(artifact));
});

it('rejects an unknown contract before interpreting its entry schema', () => {
  expect(() => validateExperimentalPackageArtifact({ kind: 'memoized-dom-package', version: 1,
    compatibility: { compiler: 99 }, entries: null })).toThrow('unsupported compiler contract 99');
});
