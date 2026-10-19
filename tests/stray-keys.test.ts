/**
 * `key` outside a list row follows React: a literal key has no effect, and a
 * key that changes remounts its element (fresh state, fresh nodes).
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
  const directory = join(import.meta.dirname, 'fixtures/out/stray-keys', name);
  mkdirSync(directory, { recursive: true });
  const output = compileModules({ './App.tsx': app }, { runtimePath: '@memoized-dom/runtime/testing' });
  for (const [file, code] of Object.entries(output)) writeFileSync(join(directory, file), code);
  const { App } = await import(/* @vite-ignore */ pathToFileURL(join(directory, 'App.tsx')).href);
  setScheduler(run => run());
  document.body.append(App('App', null));
  await Promise.resolve();
  return {
    click: (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    text: (id: string) => document.querySelector(`#${id}`)!.textContent,
    node: (id: string) => document.querySelector(`#${id}`),
  };
}

it('a literal key outside a list has no effect', async () => {
  const app = await mountApp('literal', `
    export function App() {
      let n = 0;
      return <main key="root"><button id="b" key="button" onClick={() => { n++; }}>b</button><p id="o" key={'out'}>{n}</p></main>;
    }`);
  app.click('b');
  expect(app.text('o')).toBe('1');
});

const COUNTER = `
  function Counter({ label }) {
    let count = 0;
    return <div><button id={'inc-' + label} onClick={() => { count++; }}>inc</button><p id="count">{label}:{count}</p></div>;
  }`;

it('a changed key remounts a component with fresh state', async () => {
  const app = await mountApp('remount', `${COUNTER}
    export function App() {
      let user = 'a';
      let other = 0;
      return <main>
        <button id="switch" onClick={() => { user = user === 'a' ? 'b' : 'a'; }}>switch</button>
        <button id="other" onClick={() => { other++; }}>other</button>
        <p id="other-value">{other}</p>
        <Counter key={user} label={user} />
      </main>;
    }`);
  app.click('inc-a');
  app.click('inc-a');
  expect(app.text('count')).toBe('a:2');
  // An unrelated update keeps the same key: no remount, state kept.
  app.click('other');
  expect(app.text('other-value')).toBe('1');
  expect(app.text('count')).toBe('a:2');
  // A new key: a fresh Counter.
  app.click('switch');
  expect(app.text('count')).toBe('b:0');
  app.click('switch');
  expect(app.text('count')).toBe('a:0');
});

it('a changed key on a host element replaces its node', async () => {
  const app = await mountApp('host', `
    export function App() {
      let version = 1;
      return <main><button id="next" onClick={() => { version++; }}>next</button><section id="panel" key={version}>v{version}</section></main>;
    }`);
  const first = app.node('panel');
  app.click('next');
  expect(app.text('panel')).toBe('v2');
  expect(app.node('panel')).not.toBe(first);
});

it('a keyed element as a component root and as a conditional branch', async () => {
  const app = await mountApp('positions', `${COUNTER}
    function Shell({ name }) {
      return <Counter key={name} label={name} />;
    }
    export function App() {
      let name = 'x';
      let on = true;
      return <main>
        <button id="rename" onClick={() => { name = name + 'x'; }}>rename</button>
        <button id="toggle" onClick={() => { on = !on; }}>toggle</button>
        {on ? <Shell key={name} name={name} /> : <p id="off">off</p>}
      </main>;
    }`);
  app.click('inc-x');
  expect(app.text('count')).toBe('x:1');
  app.click('rename');
  expect(app.text('count')).toBe('xx:0');
  app.click('toggle');
  expect(app.text('off')).toBe('off');
  app.click('toggle');
  expect(app.text('count')).toBe('xx:0');
});
