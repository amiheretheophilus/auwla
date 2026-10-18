/**
 * Reactive refs: `ref={box}` is a write to `box`. Markup, derivations and
 * effects that read the ref update when its node mounts, is replaced, or
 * leaves, with no ref-plus-effect pattern in authored code.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { registeredIds, unregisterSubtree, setScheduler, resetScheduler } from '@memoized-dom/runtime/testing';

afterEach(() => {
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler();
  document.body.replaceChildren();
});

async function mountApp(name: string, app: string) {
  const directory = join(import.meta.dirname, 'fixtures/out/reactive-refs', name);
  mkdirSync(directory, { recursive: true });
  const output = compileModules({ './App.tsx': app }, { runtimePath: '@memoized-dom/runtime/testing' });
  for (const [file, code] of Object.entries(output)) writeFileSync(join(directory, file), code);
  const { App } = await import(/* @vite-ignore */ pathToFileURL(join(directory, 'App.tsx')).href);
  setScheduler(run => run());
  document.body.append(App('App', null));
  // The mount-time update lands once the creating task finishes.
  await Promise.resolve();
  return {
    click: (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    text: (id: string) => document.querySelector(`#${id}`)!.textContent,
  };
}

it('markup reading a ref shows the node once it mounts', async () => {
  const app = await mountApp('text', `
    export function App() {
      let box;
      return <main><div id="box" ref={box}>x</div><p id="out">{box ? box.id : 'none'}</p></main>;
    }`);
  expect(app.text('out')).toBe('box');
});

it('a derivation of a ref re-derives on mount', async () => {
  const app = await mountApp('derived', `
    export function App() {
      let box;
      const name = box?.tagName.toLowerCase() ?? 'none';
      return <main><p id="out">{name}</p><section ref={box}>x</section></main>;
    }`);
  expect(app.text('out')).toBe('section');
});

it('a member ref is a write to its path', async () => {
  const app = await mountApp('member', `
    export function App() {
      const nodes = {};
      return <main><p id="out">{nodes.box?.id ?? 'none'}</p><div id="member" ref={nodes.box}>x</div></main>;
    }`);
  expect(app.text('out')).toBe('member');
});

it('readers follow the node when a branch replaces it, and clear when it leaves', async () => {
  const app = await mountApp('branch', `
    export function App() {
      let box;
      let mode = 'a';
      return <main>
        <button id="next" onClick={() => { mode = mode === 'a' ? 'b' : mode === 'b' ? 'none' : 'a'; }}>next</button>
        {mode === 'a' ? <div id="first" ref={box}>a</div> : mode === 'b' ? <span id="second" ref={box}>b</span> : null}
        <p id="out">{box?.id ?? 'none'}</p>
      </main>;
    }`);
  expect(app.text('out')).toBe('first');
  app.click('next');
  expect(app.text('out')).toBe('second');
  app.click('next');
  expect(app.text('out')).toBe('none');
  app.click('next');
  expect(app.text('out')).toBe('first');
});

it('state written by an authored ref callback updates its readers', async () => {
  const app = await mountApp('authored', `
    export function App() {
      let width = 0;
      return <main><div id="measured" ref={node => { width = node.id.length; }}>x</div><p id="out">{width}</p></main>;
    }`);
  expect(app.text('out')).toBe('8');
});

it('an effect reading a ref runs with the node, without re-running itself', async () => {
  const app = await mountApp('effect', `
    export function App() {
      let host;
      let text = 'one';
      $effect(() => { if (host !== undefined) host.textContent = text; });
      return <main>
        <button id="next" onClick={() => { text = 'two'; }}>next</button>
        <div id="host" ref={host}></div>
      </main>;
    }`);
  expect(app.text('host')).toBe('one');
  app.click('next');
  expect(app.text('host')).toBe('two');
});

it('an effect that already saw the mounted node does not re-run for the mount', async () => {
  const app = await mountApp('effect-once', `
    globalThis.__refEffectRuns = [];
    export function App() {
      let node;
      let mode = 'a';
      $effect(() => { globalThis.__refEffectRuns.push(node?.id ?? 'none'); });
      return <main>
        <button id="next" onClick={() => { mode = mode === 'a' ? 'b' : 'a'; }}>next</button>
        {mode === 'a' ? <div id="first" ref={node}>a</div> : <div id="second" ref={node}>b</div>}
      </main>;
    }`);
  const runs = (globalThis as unknown as { __refEffectRuns: string[] }).__refEffectRuns;
  expect(runs).toEqual(['first']);
  app.click('next');
  expect(runs.at(-1)).toBe('second');
});

it('a row ref read by its own row updates that row', async () => {
  const app = await mountApp('row', `
    function Row({ label }) {
      let cell;
      return <li><span ref={cell}>{label}</span><b>{cell?.textContent ?? ''}</b></li>;
    }
    export function App() {
      let rows = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];
      return <main>
        <button id="add" onClick={() => { rows.push({ id: 3, label: 'three' }); }}>add</button>
        <ul id="list">{rows.map(row => <Row key={row.id} label={row.label} />)}</ul>
      </main>;
    }`);
  expect(app.text('list')).toBe('oneonetwotwo');
  app.click('add');
  expect(app.text('list')).toBe('oneonetwotwothreethree');
});
