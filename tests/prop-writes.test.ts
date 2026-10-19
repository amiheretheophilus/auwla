/**
 * A prop binding is a local: a component may reassign it. The write updates
 * the component's readers and stays until the parent sends a different value
 * for that prop, which replaces it.
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
  const directory = join(import.meta.dirname, 'fixtures/out/prop-writes', name);
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

const parent = (child: string) => `
  ${child}
  export function App() {
    let name = 'a';
    let other = 0;
    return <main>
      <button id="rename" onClick={() => { name = name + 'a'; }}>rename</button>
      <button id="other" onClick={() => { other++; }}>other</button>
      <p id="other-value">{other}</p>
      <Child label={name} other={other} />
    </main>;
  }`;

it('a reassigned prop updates its readers until the parent sends a new value', async () => {
  const app = await mountApp('assign', parent(`
    function Child({ label, other }) {
      return <div><button id="local" onClick={() => { label = label + '!'; }}>local</button><p id="label">{label}</p><p id="seen">{other}</p></div>;
    }`));
  expect(app.text('label')).toBe('a');
  app.click('local');
  expect(app.text('label')).toBe('a!');
  // Another prop changes; this prop still delivers 'a', so the override stays.
  app.click('other');
  expect(app.text('seen')).toBe('1');
  expect(app.text('label')).toBe('a!');
  // The parent sends a different value: it replaces the override.
  app.click('rename');
  expect(app.text('label')).toBe('aa');
  app.click('local');
  expect(app.text('label')).toBe('aa!');
});

it('an updated prop re-derives its derivations', async () => {
  const app = await mountApp('update', parent(`
    function Child({ label, other }) {
      let count = other;
      const loud = label.toUpperCase() + count;
      return <div><button id="local" onClick={() => { label = 'z'; count++; }}>local</button><p id="loud">{loud}</p></div>;
    }`));
  expect(app.text('loud')).toBe('A0');
  app.click('local');
  expect(app.text('loud')).toBe('Z1');
  app.click('rename');
  expect(app.text('loud')).toBe('AA1');
});

it('a prop incremented in place is a local counter seeded by the parent', async () => {
  const app = await mountApp('increment', `
    function Counter({ start }) {
      return <div><button id="inc" onClick={() => { start++; }}>inc</button><p id="n">{start}</p></div>;
    }
    export function App() {
      let base = 10;
      return <main><button id="reset" onClick={() => { base = base + 10; }}>reset</button><Counter start={base} /></main>;
    }`);
  app.click('inc');
  app.click('inc');
  expect(app.text('n')).toBe('12');
  app.click('reset');
  expect(app.text('n')).toBe('20');
});

it('each row keeps its own prop override', async () => {
  const app = await mountApp('rows', `
    function Row({ label }) {
      return <li><button id={'edit-' + label} onClick={() => { label = label.toUpperCase(); }}>e</button><span>{label}</span></li>;
    }
    export function App() {
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
      return <main>
        <button id="add" onClick={() => { rows.push({ id: 3, label: 'c' }); }}>add</button>
        <ul id="list">{rows.map(row => <Row key={row.id} label={row.label} />)}</ul>
      </main>;
    }`);
  app.click('edit-a');
  expect(app.text('list')).toBe('eAeb');
  app.click('add');
  expect(app.text('list')).toBe('eAebec');
});
