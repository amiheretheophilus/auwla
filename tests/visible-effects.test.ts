/**
 * Every effect that ordinary JavaScript would show in the console shows on the
 * UI: writes through derivations, aliases, chained and value-position
 * assignments, lists over module values, and edits of derived copies.
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
  const directory = join(import.meta.dirname, 'fixtures/out/visible-effects', name);
  mkdirSync(directory, { recursive: true });
  const output = compileModules({ './App.tsx': app }, { runtimePath: '@memoized-dom/runtime/testing' });
  for (const [file, code] of Object.entries(output)) writeFileSync(join(directory, file), code);
  const { App } = await import(/* @vite-ignore */ pathToFileURL(join(directory, 'App.tsx')).href);
  setScheduler(run => run());
  document.body.append(App('App', null));
  await Promise.resolve();
  return {
    click: (id = 'b') => document.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
    text: (id = 'o') => document.querySelector(`#${id}`)!.textContent,
  };
}

it('assign a let derivation', async () => {
  const app = await mountApp('let-derivation', `export function App() { let a = 1; let total = a * 2; return <main><button id="b" onClick={() => { total = 10; }}>b</button><button id="a" onClick={() => { a = 7; }}>a</button><p id="o">{total}</p></main>; }`);
  expect(app.text()).toBe('2');
  app.click();
  expect(app.text()).toBe('10');
  // A written let is plain state, set once from its initializer, as in the console.
  app.click('a');
  expect(app.text()).toBe('10');
});

it('mutate a const derivation', async () => {
  const app = await mountApp('const-derivation', `export function App() { let items = [3, 1]; const sorted = items.slice(); return <main><button id="b" onClick={() => { sorted.push(0); }}>b</button><p id="o">{sorted.length}</p></main>; }`);
  app.click();
  expect(app.text()).toBe('3');
});

it('reassign module store', async () => {
  const app = await mountApp('store', `let store = { n: 1 }; export function App() { return <main><button id="b" onClick={() => { store = { n: 2 }; }}>b</button><p id="o">{store.n}</p></main>; }`);
  app.click();
  expect(app.text()).toBe('2');
});

it('module computed write', async () => {
  const app = await mountApp('computed', `let items = [1]; let count = items.length; export function App() { return <main><button id="b" onClick={() => { count = 0; }}>b</button><p id="o">{count}</p></main>; }`);
  app.click();
  expect(app.text()).toBe('0');
});

it('chained assignment', async () => {
  const app = await mountApp('chained', `let a = 0; let b = 0; export function App() { return <main><button id="b" onClick={() => { a = b = 1; }}>b</button><p id="o">{a}{b}</p></main>; }`);
  app.click();
  expect(app.text()).toBe('11');
});

it('assignment as value', async () => {
  const app = await mountApp('as-value', `let count = 0; let last = -1; export function App() { return <main><button id="b" onClick={() => { last = count++; }}>b</button><p id="o">{count}:{last}</p></main>; }`);
  app.click();
  expect(app.text()).toBe('1:0');
});

it('map over module const', async () => {
  const app = await mountApp('module-const', `const ITEMS = [1, 2]; export function App() { return <main><button id="b" onClick={() => { ITEMS.push(3); }}>b</button><ul id="o">{ITEMS.map(i => <li key={i}>{i}</li>)}</ul></main>; }`);
  expect(app.text()).toBe('12');
  app.click();
  expect(app.text()).toBe('123');
});

it('filter then map inline', async () => {
  const app = await mountApp('filter-map', `export function App() { let items = [1, 2]; return <main><button id="b" onClick={() => { items.push(3); }}>b</button><ul id="o">{items.filter(i => i > 1).map(i => <li key={i}>{i}</li>)}</ul></main>; }`);
  expect(app.text()).toBe('2');
  app.click();
  expect(app.text()).toBe('23');
});

it('map with function reference', async () => {
  const app = await mountApp('fn-ref', `function Row(item) { return <li>{item}</li>; } export function App() { let items = [1]; return <main><button id="b" onClick={() => { items.push(2); }}>b</button><ul id="o">{items.map(Row)}</ul></main>; }`);
  expect(app.text()).toBe('1');
  app.click();
  expect(app.text()).toBe('12');
});

it('effect inside if', async () => {
  const app = await mountApp('effect-if', `globalThis.__ran = 0; export function App() { let on = true; if (on) { $effect(() => { globalThis.__ran++; }); } return <p id="o">x</p>; }`);
  expect((globalThis as unknown as { __ran: number }).__ran).toBe(1);
  void app;
});

it('switch on state', async () => {
  const app = await mountApp('switch', `export function App() { let m = 'a'; let label; switch (m) { case 'a': label = 'A'; break; default: label = '?'; } return <main><button id="b" onClick={() => { m = 'z'; }}>b</button><p id="o">{label}</p></main>; }`);
  expect(app.text()).toBe('A');
  app.click();
  expect(app.text()).toBe('?');
});

it('nullish in JSX', async () => {
  const app = await mountApp('nullish', `export function App() { let a = null; return <main><button id="b" onClick={() => { a = 'set'; }}>b</button><p id="o">{a ?? 'none'}</p></main>; }`);
  expect(app.text()).toBe('none');
  app.click();
  expect(app.text()).toBe('set');
});

it('mutate a derived copy of written state', async () => {
  const app = await mountApp('derived-copy', `export function App() { let items = [3, 1]; const sorted = items.slice(); return <main><button id="b" onClick={() => { sorted.push(0); }}>b</button><button id="i" onClick={() => { items.push(9); }}>i</button><p id="o">{sorted.length}</p></main>; }`);
  app.click();
  expect(app.text()).toBe('3');
  app.click('i');
  expect(app.text()).toBe('3');
});
