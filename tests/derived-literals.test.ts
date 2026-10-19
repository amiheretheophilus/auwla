/**
 * Rule 11: an object, array or `new` value built from state is a derivation,
 * derived again when that state changes; one built from nothing reactive is a
 * state root, created once.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { registeredIds, unregisterSubtree, setScheduler, resetScheduler } from '@memoized-dom/runtime/testing';
afterEach(() => { for (const id of registeredIds()) unregisterSubtree(id); resetScheduler(); document.body.replaceChildren(); });
async function mountApp(name: string, app: string) {
  const directory = join(import.meta.dirname, 'fixtures/out/derived-literals', name);
  mkdirSync(directory, { recursive: true });
  const output = compileModules({ './App.tsx': app }, { runtimePath: '@memoized-dom/runtime/testing' });
  for (const [file, code] of Object.entries(output)) writeFileSync(join(directory, file), code);
  const { App } = await import(pathToFileURL(join(directory, 'App.tsx')).href);
  setScheduler(run => run()); document.body.append(App('App', null)); await Promise.resolve();
  return { click: () => document.querySelector<HTMLButtonElement>('#b')!.click(), text: () => document.querySelector('#o')!.textContent };
}
it('array literal reading state', async () => {
  const app = await mountApp('array', `export function App() { let a = 1; const pair = [a, 2]; return <main><button id="b" onClick={() => { a++; }}>b</button><p id="o">{pair[0]}</p></main>; }`);
  app.click(); expect(app.text()).toBe('2');
});
it('object literal reading state', async () => {
  const app = await mountApp('object', `export function App() { let a = 1; const box = { a }; return <main><button id="b" onClick={() => { a++; }}>b</button><p id="o">{box.a}</p></main>; }`);
  app.click(); expect(app.text()).toBe('2');
});
it('new expression reading state', async () => {
  const app = await mountApp('new', `export function App() { let a = 1; const set = new Set([a]); return <main><button id="b" onClick={() => { a++; }}>b</button><p id="o">{[...set][0]}</p></main>; }`);
  app.click(); expect(app.text()).toBe('2');
});
it('inline array list over state', async () => {
  const app = await mountApp('inline-list', `export function App() { let a = 1; return <main><button id="b" onClick={() => { a++; }}>b</button><ul id="o">{[a].map(v => <li key={v}>{v}</li>)}</ul></main>; }`);
  app.click(); expect(app.text()).toBe('2');
});
