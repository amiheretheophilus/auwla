import { afterEach, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compileModulesDetailed, experimentalCompilePackage, experimentalFinalizePackage,
  experimentalVerifyPackageIntegrity,
} from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { registeredIds, unregisterSubtree, setScheduler, resetScheduler } from '@memoized-dom/runtime/testing';
import { registerRootFactory } from '@memoized-dom/runtime';
import { renderToString } from '@memoized-dom/server';
import { waitFor } from '../test-support/helpers';

const upstream = join(import.meta.dirname, 'fixtures/third-party/dset');
const hashes = {
  'dist/index.mjs': '415e1a1b26fc2db57bd76d12d72ac5b9f76497201afe14c01bfa7f2789bff1da',
  'merge/index.mjs': '43ab54b68ebf3b7964688b2b9100b9ea9a25a9dc68d5272d97926ab4dea6278b',
};
let directory: string | undefined;
let runtime: DataRuntime | undefined, previous: DataRuntime | undefined;

afterEach(async () => {
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler(); document.body.replaceChildren();
  if (previous) setActiveDataRuntime(previous);
  runtime?.clear(); runtime = previous = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function put(file: string, source: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, source);
}

async function compileThirdParty() {
  const parent = join(import.meta.dirname, 'fixtures/out/third-party-package');
  await mkdir(parent, { recursive: true }); directory = await mkdtemp(join(parent, 'dset-'));
  const modules: Record<string, string> = {};
  for (const [file, hash] of Object.entries(hashes)) {
    const source = await readFile(join(upstream, file), 'utf8');
    expect(createHash('sha256').update(source).digest('hex')).toBe(hash);
    modules['./' + file] = source;
  }
  // No manually supplied writes, sources, helper names, or runtimeOwnedState.
  const compiled = experimentalCompilePackage(modules, {
    packageEntries: { dset: './dist/index.mjs', 'dset/merge': './merge/index.mjs' },
  });
  const output = join(directory, 'node_modules/dset');
  for (const [file, code] of Object.entries(compiled.output)) await put(join(output, file), code);
  await put(join(output, 'package.json'), JSON.stringify({
    name: 'dset', version: '3.1.4', type: 'module',
    exports: { '.': './dist/index.mjs', './merge': './merge/index.mjs' },
    'memoized-dom': { artifact: './memoized-dom.package.json', integrity: true },
  }));
  const artifact = await experimentalFinalizePackage(compiled.artifact, { packageRoot: output, outputDirectory: '.' });
  await put(join(output, 'memoized-dom.package.json'), JSON.stringify(artifact));
  expect(await experimentalVerifyPackageIntegrity(artifact, output)).toHaveLength(2);
  return { artifact, output };
}

async function mount(modules: Record<string, string>, artifact: Awaited<ReturnType<typeof compileThirdParty>>['artifact']) {
  const app = compileModulesDetailed(modules, {
    experimentalPackageArtifacts: [artifact], runtimePath: '@memoized-dom/runtime/testing',
  });
  for (const [file, code] of Object.entries(app.output)) await put(join(directory!, file), code);
  const { App } = await import(pathToFileURL(join(directory!, 'App.tsx')).href);
  setScheduler(run => run()); document.body.append(App('App', null));
  return app;
}

it('compiles the exact published .mjs files and infers deep argument writes without a boundary', async () => {
  const { artifact } = await compileThirdParty();
  expect(Object.keys(artifact.entries)).toEqual(['dset', 'dset/merge']);
  expect(artifact.entries.dset!.functions.dset!.parameterWrites).toContainEqual({ index: 0, path: [] });
  expect(artifact.entries['dset/merge']!.functions.merge!.parameterWrites).toContainEqual({ index: 0, path: [] });
  expect(artifact.entries.dset!.functions.dset!.unbounded).toBe(false);
  for (const [file, hash] of Object.entries(hashes)) {
    expect(createHash('sha256').update(await readFile(join(upstream, file))).digest('hex')).toBe(hash);
  }
});

it('resolves a local .mjs implementation through an extensionless ESM barrel', async () => {
  const source = await readFile(join(upstream, 'dist/index.mjs'), 'utf8');
  const compiled = experimentalCompilePackage({
    './index.mjs': `export {dset} from './implementation';`, './implementation.mjs': source,
  }, { packageEntries: { dset: './index.mjs' } });
  expect(compiled.artifact.entries.dset!.functions.dset!.parameterWrites).toContainEqual({ index: 0, path: [] });
});

it('routes deep writes to a sibling and derived reads through ordinary imports, aliases and subpaths', async () => {
  const { artifact } = await compileThirdParty();
  await mount({
    './state.ts': `export const model={profile:{name:'before'},items:[{text:'first'}]};`,
    './commands.ts': `export {dset as update} from 'dset';`,
    './Label.tsx': `import {model} from './state';export function Label(){
      const label=model.profile.name.toUpperCase();return <output id="out">{label}:{model.items[0].text}</output>;}`,
    './App.tsx': `import {model} from './state';import {update} from './commands';
      import {dset as mergePath} from 'dset/merge';import {Label} from './Label';
      export function App(){return <main><Label/><input id="draft"/>
        <button id="rename" onClick={()=>update(model,'profile.name','after')}>Rename</button>
        <button id="row" onClick={()=>update(model,['items',0,'text'],'changed')}>Row</button>
        <button id="merge" onClick={()=>mergePath(model,'profile',{name:'merged',extra:true})}>Merge</button>
      </main>;}`,
  }, artifact);
  const original = document.querySelector('#out');
  const draft = document.querySelector<HTMLInputElement>('#draft')!; draft.value = 'keep';
  expect(original!.textContent).toBe('BEFORE:first');
  document.querySelector<HTMLButtonElement>('#rename')!.click();
  expect(original!.textContent).toBe('AFTER:first');
  document.querySelector<HTMLButtonElement>('#row')!.click();
  expect(original!.textContent).toBe('AFTER:changed');
  document.querySelector<HTMLButtonElement>('#merge')!.click();
  expect(original!.textContent).toBe('MERGED:changed');
  expect(document.querySelector('#out')).toBe(original);
  expect(document.querySelector('#draft')).toBe(draft); expect(draft.value).toBe('keep');
});

it.each([
  ['whole payload', `dset(profile,'user.name','edited')`],
  ['nested payload', `dset(profile.user,'name','edited')`],
  ['ordinary source helper', `rename(profile,'edited')`],
])('publishes a summarized mutation of a resolved %s without another request', async (_kind, mutation) => {
  const { artifact } = await compileThirdParty();
  const response = Promise.withResolvers<Response>(); let requests = 0;
  runtime = createDataRuntime({ fetch: () => { requests++; return response.promise; } });
  previous = setActiveDataRuntime(runtime);
  await mount({
    './rename.ts': `export function rename(profile:{user:{name:string}},name:string){profile.user.name=name;}`,
    './App.tsx': `import {dset} from 'dset';import {rename} from './rename';export function App(){
      const profile=$fetch<{user:{name:string}}>('/profile');
      return <main><output id="out">{profile.user.name}</output>
        <button id="rename" onClick={()=>${mutation}}>Edit</button>
        <span id="status">{$track(profile).status}</span></main>;}`,
  }, artifact);
  response.resolve(Response.json({ user: { name: 'server' } }));
  await waitFor(() => expect(document.querySelector('#out')!.textContent).toBe('server'));
  const original = document.querySelector('#out');
  document.querySelector<HTMLButtonElement>('#rename')!.click();
  await waitFor(() => expect(original!.textContent).toBe('edited'));
  expect(document.querySelector('#out')).toBe(original);
  expect(document.querySelector('#status')!.textContent).toBe('success'); expect(requests).toBe(1);
});

it('uses the compiled JavaScript in a server render without a browser-only wrapper', async () => {
  const { artifact } = await compileThirdParty();
  const app = compileModulesDetailed({
    './App.tsx': `import {dset} from 'dset';export function App(){
      const model={name:'before'};dset(model,'name','Server Ada');return <h1>{model.name}</h1>;}`,
  }, { experimentalPackageArtifacts: [artifact], routedEnvironment: 'server', moduleStateCells: true });
  await put(join(directory!, 'App.tsx'), app.output['./App.tsx']!);
  const { App } = await import(pathToFileURL(join(directory!, 'App.tsx')).href);
  registerRootFactory(App, { id: 'ThirdPartyServer', create: () => App('ThirdPartyServer', null) });
  expect(renderToString(App)).toContain('<h1>Server Ada</h1>');
});

type Setter = (object: Record<string, unknown>, keys: string | (string | number)[], value: unknown) => void;
it('preserves upstream mutation and prototype guards in compiled JavaScript', async () => {
  const { output } = await compileThirdParty();
  for (const entry of Object.keys(hashes)) {
    const original = await import(pathToFileURL(join(upstream, entry)).href) as { dset: Setter };
    const compiled = await import(pathToFileURL(join(output, entry)).href) as { dset: Setter };
    const cases: [string | (string | number)[], unknown][] = [
      ['profile.name', 'Ada'], [['items', 0, 'text'], 'first'], ['profile', { city: 'Accra' }],
      ['items.1.text', 'second'], ['__proto__.mmdPolluted', true], ['constructor.prototype.mmdPolluted', true],
      ['prototype.mmdPolluted', true], ['profile.name', null],
    ];
    const expected = {}, actual = {};
    for (const [keys, value] of cases) {
      original.dset(expected, structuredClone(keys), structuredClone(value));
      compiled.dset(actual, structuredClone(keys), structuredClone(value));
      expect(actual).toEqual(expected);
    }
    expect(Object.hasOwn(Object.prototype, 'mmdPolluted')).toBe(false);
  }
});
