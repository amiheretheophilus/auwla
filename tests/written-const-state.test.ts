/**
 * A written `const` is state like a written `let`: the keyword never decides
 * reactivity. Covers values built by helpers, globals and array-literal method
 * chains (`[1].concat(…)`), as text and as list sources.
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
  const directory = join(import.meta.dirname, 'fixtures/out/written-const-state', name);
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
  };
}

const cases: Array<[string, string, string]> = [
  ['helper-array', 'function makeList() { return [1, 2]; }', 'const items = makeList();'],
  ['concat', '', 'const items = [1].concat([2]);'],
  ['spread-object', 'const base = { a: 1 };', 'const items = { ...base, list: [1, 2] }.list;'],
  ['array-from', '', 'const items = Array.from([1, 2]);'],
  ['let-helper', 'function makeList() { return [1, 2]; }', 'let items = makeList();'],
];

for (const [name, prelude, declaration] of cases) {
  it(`a mutated const is state: ${name}`, async () => {
    const app = await mountApp(name, `
      ${prelude}
      export function App() {
        ${declaration}
        return <main><button id="b" onClick={() => { items.push(3); }}>b</button><p id="n">{items.length}</p></main>;
      }`);
    expect(app.text('n')).toBe('2');
    app.click('b');
    expect(app.text('n')).toBe('3');
  });
}

for (const [name, prelude, declaration] of cases) {
  it(`a mutated const renders as a list: ${name}`, async () => {
    const app = await mountApp(`list-${name}`, `
      ${prelude}
      export function App() {
        ${declaration}
        return <main><button id="b" onClick={() => { items.push(3); }}>b</button><ul id="n">{items.map(item => <li key={item}>{item}</li>)}</ul></main>;
      }`);
    expect(app.text('n')).toBe('12');
    app.click('b');
    expect(app.text('n')).toBe('123');
  });
}

it('a mutated const object with a computed key is state', async () => {
  const app = await mountApp('computed-key', `
    const key = 'a';
    export function App() {
      const counts = { [key]: 1 };
      return <main><button id="b" onClick={() => { counts.a++; }}>b</button><p id="n">{counts.a}</p></main>;
    }`);
  app.click('b');
  expect(app.text('n')).toBe('2');
});

it('a mutated const from a helper object is state', async () => {
  const app = await mountApp('helper-object', `
    function makeCounter() { return { value: 1 }; }
    export function App() {
      const counter = makeCounter();
      return <main><button id="b" onClick={() => { counter.value++; }}>b</button><p id="n">{counter.value}</p></main>;
    }`);
  app.click('b');
  expect(app.text('n')).toBe('2');
});

it('a read-only method call on an array-literal chain in a handler compiles', async () => {
  const app = await mountApp('chain-read', `
    export function App() {
      let shown = '';
      const doubled = [1, 2].map(value => value * 2);
      return <main><button id="b" onClick={() => { shown = doubled.join(','); }}>b</button><p id="n">{shown}</p><ul>{doubled.map(value => <li key={value}>{value}</li>)}</ul></main>;
    }`);
  app.click('b');
  expect(app.text('n')).toBe('2,4');
});
