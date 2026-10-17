import { afterEach, expect, it, vi } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compileModulesDetailed, experimentalCompilePackage, experimentalFinalizePackage,
  experimentalVerifyPackageIntegrity, type ExperimentalPackageArtifact,
} from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { registeredIds, unregisterSubtree, setScheduler, resetScheduler } from '@memoized-dom/runtime/testing';
import { waitFor } from '../test-support/helpers';
import { closeBrowser } from '../test-support/browser';
import puppeteer from 'puppeteer-core';

type Mode = 'opaque' | 'compiled';
const fixture = join(import.meta.dirname, 'fixtures/third-party/throttle-debounce');
const sourceHash = 'bf8f81da567b6a542d112b46e521d4295e68d97531343a55bfdec8e728fa5340';
let directory: string | undefined;
let runtime: DataRuntime | undefined, previous: DataRuntime | undefined;

afterEach(async () => {
  for (const id of registeredIds()) unregisterSubtree(id);
  vi.useRealTimers(); resetScheduler(); document.body.replaceChildren();
  if (previous) setActiveDataRuntime(previous);
  runtime?.clear(); runtime = previous = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function put(file: string, source: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, source);
}

async function prepare(mode: Mode, modules: Record<string, string>, runtimePath = '@memoized-dom/runtime/testing') {
  const parent = join(import.meta.dirname, 'fixtures/out/third-party-callbacks');
  await mkdir(parent, { recursive: true }); directory = await mkdtemp(join(parent, mode + '-'));
  const source = await readFile(join(fixture, 'esm/index.js'), 'utf8');
  expect(createHash('sha256').update(source).digest('hex')).toBe(sourceHash);
  const packaged = mode === 'compiled' ? experimentalCompilePackage({ './esm/index.js': source }, {
    packageEntries: { 'throttle-debounce': './esm/index.js' },
  }) : undefined;
  const output = join(directory, 'node_modules/throttle-debounce');
  for (const [file, code] of Object.entries(packaged?.output ?? { './esm/index.js': source })) await put(join(output, file), code);
  await put(join(output, 'package.json'), JSON.stringify({
    name: 'throttle-debounce', version: '5.0.2', type: 'module', exports: { '.': './esm/index.js' },
    ...(packaged ? { 'memoized-dom': { artifact: './memoized-dom.package.json', integrity: true } } : {}),
  }));
  let artifact: ExperimentalPackageArtifact | undefined;
  if (packaged) {
    artifact = await experimentalFinalizePackage(packaged.artifact, { packageRoot: output, outputDirectory: '.' });
    await put(join(output, 'memoized-dom.package.json'), JSON.stringify(artifact));
    expect(await experimentalVerifyPackageIntegrity(artifact, output)).toHaveLength(1);
  }
  const application = compileModulesDetailed(modules, {
    runtimePath,
    ...(artifact ? { experimentalPackageArtifacts: [artifact] } : {}),
  });
  for (const [file, code] of Object.entries(application.output)) await put(join(directory, file), code);
  return application;
}

async function mount(mode: Mode, modules: Record<string, string>) {
  const application = await prepare(mode, modules);
  const module = await import(pathToFileURL(join(directory!, 'App.tsx')).href);
  setScheduler(run => run()); document.body.append(module.App('App', null));
  return { application, module };
}

const chrome = [process.env.MMD_CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find((path): path is string => !!path && existsSync(path));

for (const mode of ['opaque', 'compiled'] as const) {
  it.skipIf(!chrome)(`${mode}: production Chromium keeps delayed writes, instance state and cleanup correct`, async () => {
    await prepare(mode, {
      './state.ts': `export const model={name:'before'};export const executions=[];
        export function receive(value){model.name=value;}`,
      './Label.tsx': `import {model} from './state';export function Label(){return <output id="shared">{model.name}</output>;}`,
      './App.tsx': `import {debounce} from 'throttle-debounce';import {receive,executions} from './state';import {Label} from './Label';
        function Editor({name}){executions.push('setup:'+name);let count=0;
          const later=debounce(40,async()=>{await Promise.resolve();count++;executions.push(name);});
          $cleanup(()=>later.cancel());return <section><output data-count={name}>{count}</output>
            <button data-save={name} onClick={()=>later()}>Save</button></section>;}
        export function App(){let open=true;const later=debounce(40,receive);$cleanup(()=>later.cancel());
          return <main><Label/><input id="draft"/><button id="shared-save" onClick={()=>{later('first');later('last');}}>Shared</button>
            <button id="toggle" onClick={()=>open=!open}>Toggle</button>{open&&<Editor name="left"/>}<Editor name="right"/></main>;}`,
    }, '@memoized-dom/runtime');
    await put(join(directory!, 'entry.ts'), `import {App} from './App.tsx';import {executions} from './state.ts';
      import {setScheduler} from '@memoized-dom/runtime';setScheduler(run=>run());
      document.body.append(App('App',null));Object.assign(window,{executions});`);
    const build = await Bun.build({ entrypoints: [join(directory!, 'entry.ts')], target: 'browser', format: 'esm', minify: true });
    expect(build.success).toBe(true);
    const code = await build.outputs[0]!.text();
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      return new URL(request.url).pathname === '/app.js'
        ? new Response(code, { headers: { 'content-type': 'text/javascript' } })
        : new Response('<!doctype html><body><script type="module" src="/app.js"></script>', { headers: { 'content-type': 'text/html' } });
    } });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
      browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      const page = await browser.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
      await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: 'load' });
      await page.waitForSelector('[data-count="right"]');
      await page.evaluate(() => {
        const draft = document.querySelector<HTMLInputElement>('#draft')!; draft.value = 'keep';
        Object.assign(window, { initialShared: document.querySelector('#shared'), initialDraft: draft,
          initialRight: document.querySelector('[data-count="right"]') });
        document.querySelector<HTMLButtonElement>('#shared-save')!.click();
        document.querySelector<HTMLButtonElement>('[data-save="left"]')!.click();
        document.querySelector<HTMLButtonElement>('#toggle')!.click();
        document.querySelector<HTMLButtonElement>('[data-save="right"]')!.click();
      });
      await page.waitForFunction(() => document.querySelector('#shared')?.textContent === 'last' &&
        document.querySelector('[data-count="right"]')?.textContent === '1');
      const state = await page.evaluate(() => {
        const state = window as unknown as { executions: string[]; initialShared: Node; initialDraft: Node; initialRight: Node };
        return { executions: [...state.executions].sort(), sharedRetained: state.initialShared === document.querySelector('#shared'),
          rightRetained: state.initialRight === document.querySelector('[data-count="right"]'),
          draftRetained: state.initialDraft === document.querySelector('#draft'),
          draft: document.querySelector<HTMLInputElement>('#draft')!.value, leftRemoved: !document.querySelector('[data-count="left"]') };
      });
      expect(state).toEqual({ executions: ['right', 'setup:left', 'setup:right'], sharedRetained: true,
        rightRetained: true, draftRetained: true, draft: 'keep', leftRemoved: true });
      await page.click('#toggle');
      expect(await page.$eval('[data-count="left"]', element => element.textContent)).toBe('0');
      await page.click('[data-save="left"]');
      await page.waitForFunction(() => document.querySelector('[data-count="left"]')?.textContent === '1');
      expect(await page.evaluate(() => [...(window as unknown as { executions: string[] }).executions].sort()))
        .toEqual(['left', 'right', 'setup:left', 'setup:left', 'setup:right']);
      expect(errors).toEqual([]);
    } finally {
      try { if (browser) await closeBrowser(browser); } finally { await server.stop(true); }
    }
  }, 120_000);
}

function click(id: string): void { document.querySelector<HTMLButtonElement>('#' + id)!.click(); }
async function microtasks(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve(); }

it('pins the published callback package and both upstream licenses', async () => {
  expect(createHash('sha256').update(await readFile(join(fixture, 'esm/index.js'))).digest('hex')).toBe(sourceHash);
  expect(createHash('sha256').update(await readFile(join(fixture, 'LICENSE.md'))).digest('hex'))
    .toBe('b07649c798231a321f90abbb329c15e41a8b5ec5e814dde3e60cd4a470e3b012');
});

it('preserves upstream receiver, rest arguments and wrapper returns in compiled debounce and throttle', async () => {
  await prepare('compiled', { './App.tsx': `export function App(){return <p/>;}` });
  type Deferred = ((...args: unknown[]) => void) & { cancel(): void };
  type Factory = (delay: number, callback: (this: unknown, ...args: unknown[]) => unknown,
    options?: { noLeading?: boolean }) => Deferred;
  type Package = { debounce: Factory; throttle: Factory };
  const original = await import(pathToFileURL(join(fixture, 'esm/index.js')).href) as Package;
  const compiled = await import(pathToFileURL(join(directory!, 'node_modules/throttle-debounce/esm/index.js')).href) as Package;
  vi.useFakeTimers();
  for (const method of ['debounce', 'throttle'] as const) {
    const observed: unknown[][] = [];
    for (const packageModule of [original, compiled]) {
      const received: unknown[] = [];
      const receiver = { name: 'receiver' };
      const deferred = packageModule[method](25, function (...args) {
        received.push(this === receiver, ...args); return 'callback return';
      }, method === 'throttle' ? { noLeading: true } : undefined);
      expect(Reflect.apply(deferred, receiver, ['first', 1])).toBeUndefined();
      expect(Reflect.apply(deferred, receiver, ['last', 2, true])).toBeUndefined();
      expect(received).toEqual([]);
      vi.advanceTimersByTime(25); deferred.cancel(); observed.push(received);
    }
    expect(observed).toEqual([[true, 'last', 2, true], [true, 'last', 2, true]]);
  }
});

for (const mode of ['opaque', 'compiled'] as const) {
  it(`${mode}: updates a retained callback once with the latest arguments, preserving nodes and drafts`, async () => {
    const { module } = await mount(mode, {
      './App.tsx': `import {debounce as later} from 'throttle-debounce';
        export const calls=[];
        export function App(){let text='before';
          function receive(value){text=value;calls.push(value);}
          const save=later(25,receive);$cleanup(()=>save.cancel());
          return <main><output>{text}</output><input id="draft"/>
            <button id="first" onClick={()=>save('first')}>First</button>
            <button id="last" onClick={()=>save('last')}>Last</button></main>;}`,
    });
    const node = document.querySelector('output');
    const draft = document.querySelector<HTMLInputElement>('#draft')!; draft.value = 'keep';
    vi.useFakeTimers(); click('first'); click('last');
    expect(node!.textContent).toBe('before'); expect(module.calls).toEqual([]);
    vi.advanceTimersByTime(24); expect(node!.textContent).toBe('before');
    vi.advanceTimersByTime(1);
    expect(node!.textContent).toBe('last'); expect(module.calls).toEqual(['last']);
    expect(document.querySelector('output')).toBe(node);
    expect(document.querySelector('#draft')).toBe(draft); expect(draft.value).toBe('keep');
  });

  it(`${mode}: commits an async retained callback after await, not when its wrapper returns`, async () => {
    await mount(mode, {
      './App.tsx': `import {debounce} from 'throttle-debounce';
        export function App(){let count=0;
          const save=debounce(25,async amount=>{await Promise.resolve();count+=amount;});
          $cleanup(()=>save.cancel());
          return <main><output>{count}</output><button id="save" onClick={()=>save(3)}>Save</button></main>;}`,
    });
    vi.useFakeTimers(); click('save'); expect(document.querySelector('output')!.textContent).toBe('0');
    vi.advanceTimersByTime(25); await microtasks();
    expect(document.querySelector('output')!.textContent).toBe('3');
  });

  it(`${mode}: routes a module callback to a separately compiled sibling`, async () => {
    await mount(mode, {
      './state.ts': `export const model={name:'before'};export function receive(name){model.name=name;}`,
      './Label.tsx': `import {model} from './state';export function Label(){return <output>{model.name}</output>;}`,
      './App.tsx': `import {debounce} from 'throttle-debounce';import {receive} from './state';import {Label} from './Label';
        export function App(){const save=debounce(25,receive);$cleanup(()=>save.cancel());
          return <main><Label/><button id="save" onClick={()=>save('after')}>Save</button></main>;}`,
    });
    const original = document.querySelector('output');
    vi.useFakeTimers(); click('save'); vi.advanceTimersByTime(25);
    expect(original!.textContent).toBe('after'); expect(document.querySelector('output')).toBe(original);
  });

  it(`${mode}: notifies a resolved fetch payload from a delayed callback without refetching`, async () => {
    let requests = 0;
    runtime = createDataRuntime({ fetch: async () => { requests++; return Response.json({ name: 'server' }); } });
    previous = setActiveDataRuntime(runtime);
    await mount(mode, {
      './App.tsx': `import {debounce} from 'throttle-debounce';export function App(){const profile=$fetch('/profile');
        const save=debounce(25,async name=>{await Promise.resolve();profile.name=name;});
        $cleanup(()=>save.cancel());return <main><output>{profile.name}</output>
          <button id="save" onClick={()=>save('edited')}>Save</button></main>;}`,
    });
    await waitFor(() => expect(document.querySelector('output')!.textContent).toBe('server'));
    const original = document.querySelector('output');
    vi.useFakeTimers(); click('save'); vi.advanceTimersByTime(25); await microtasks();
    expect(original!.textContent).toBe('edited'); expect(requests).toBe(1);
    expect(document.querySelector('output')).toBe(original);
  });

  it(`${mode}: cancels pending work on component removal and gives a remount fresh private state`, async () => {
    const { module } = await mount(mode, {
      './App.tsx': `import {debounce} from 'throttle-debounce';export const calls=[];
        function Editor(){let text='before';const save=debounce(25,value=>{text=value;calls.push(value);});
          $cleanup(()=>save.cancel());return <section><output>{text}</output>
            <button id="save" onClick={()=>save('after')}>Save</button></section>;}
        export function App(){let open=true;return <main><button id="toggle" onClick={()=>open=!open}>Toggle</button>
          {open&&<Editor/>}</main>;}`,
    });
    vi.useFakeTimers(); const original = document.querySelector('output');
    click('save'); click('toggle'); expect(original!.isConnected).toBe(false);
    vi.advanceTimersByTime(25); expect(module.calls).toEqual([]);
    click('toggle'); expect(document.querySelector('output')!.textContent).toBe('before');
    expect(document.querySelector('output')).not.toBe(original);
    click('save'); vi.advanceTimersByTime(25);
    expect(document.querySelector('output')!.textContent).toBe('after'); expect(module.calls).toEqual(['after']);
  });

  it(`${mode}: preserves reusable upcoming-only cancellation and permanent cancellation`, async () => {
    const { module } = await mount(mode, {
      './App.tsx': `import {debounce} from 'throttle-debounce';export const calls=[];
        export function App(){let count=0;const save=debounce(25,()=>{count++;calls.push(count);});
          $cleanup(()=>save.cancel());return <main><output>{count}</output>
            <button id="save" onClick={()=>save()}>Save</button>
            <button id="once" onClick={()=>save.cancel({upcomingOnly:true})}>Cancel once</button>
            <button id="stop" onClick={()=>save.cancel()}>Stop</button></main>;}`,
    });
    vi.useFakeTimers(); click('save'); click('once'); vi.advanceTimersByTime(25);
    expect(module.calls).toEqual([]);
    click('save'); vi.advanceTimersByTime(25); expect(module.calls).toEqual([1]);
    click('save'); click('stop'); click('save'); vi.advanceTimersByTime(50);
    expect(module.calls).toEqual([1]); expect(document.querySelector('output')!.textContent).toBe('1');
  });
}
