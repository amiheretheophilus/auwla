/**
 * A name that holds an object state holds is an alias (`aliasBindings` in plan.ts):
 * an edit through it reports through the alias index. A destructured name is one
 * too: `[index, task]` from `entries()`, `{ task }` from a row object, or
 * `const [first] = tasks`. Before, only a plain declared name or row parameter
 * counted, so these edits changed the object and nothing showed it.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setScheduler } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

let sequence = 0;
const hosts: HTMLElement[] = [];
afterEach(() => {
  clearCompiledApps();
  for (const host of hosts.splice(0)) host.remove();
});

function compile(source: string, optimize: boolean): string {
  return compileModules({ './App.tsx': source }, { runtimePath: '@memoized-dom/runtime/testing', optimize })['./App.tsx']!;
}

async function mount(source: string, optimize: boolean): Promise<HTMLElement> {
  const directory = join(import.meta.dirname, '../../../tests/out/handler-aliases');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}-${optimize ? 'optimized' : 'general'}.js`);
  writeFileSync(file, compile(source, optimize));
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  host.append(module.App('handler-aliases', null));
  return host;
}

const row = (binding: string) => `<li><button onClick={() => { ${binding}.done = !${binding}.done; }}>{${binding}.done ? 'y' : 'n'}</button></li>`;

// Each list's rows edit an item of `tasks` through a destructured name.
const lists: Record<string, string> = {
  'entries() through Array.from': `Array.from(tasks.entries(), ([index, task]) => ${row('task')})`,
  'entries() through map': `[...tasks.entries()].map(([index, task]) => ${row('task')})`,
  'a derived list\'s entries()': `Array.from(visible.entries(), ([index, task]) => ${row('task')})`,
  'a row object': `tasks.map((task) => ({ task })).map(({ task }) => ${row('task')})`,
  'a renamed field with a default': `tasks.map((task) => ({ task })).map(({ task: item = null }) => ${row('item')})`,
  'a nested pair': `Array.from(tasks.entries(), ([index, ...[task]]) => ${row('task')})`,
};

for (const [name, list] of Object.entries(lists)) {
  for (const optimize of [true, false]) {
    it(`shows an edit through ${name} (optimize: ${optimize})`, async () => {
      const host = await mount(`
        export function App() {
          let tasks = [{ id: 1, done: false }, { id: 2, done: false }];
          const visible = tasks.filter(() => true);
          return <ul>{${list}}</ul>;
        }`, optimize);
      host.querySelectorAll('button')[1]!.click();
      expect(host.textContent).toBe('ny');
      host.querySelectorAll('button')[1]!.click();
      expect(host.textContent).toBe('nn');
    });
  }
}

it.each([true, false])('shows an edit through a destructured local in a handler (optimize: %p)', async (optimize) => {
  const host = await mount(`
    export function App() {
      let tasks = [{ id: 1, done: false }, { id: 2, done: false }];
      return <main><p>{tasks.map((task) => task.done ? 'y' : 'n').join('')}</p>
        <button onClick={() => { const [first, { done, ...second }] = tasks; first.done = true; }}>first</button></main>;
    }`, optimize);
  host.querySelector('button')!.click();
  expect(host.querySelector('p')!.textContent).toBe('yn');
});

it('leaves a plain function\'s destructured parameter to its caller', () => {
  // `mark` is not a row: whoever calls it is observed (`aliasBindings`).
  const output = compile(`
    function mark({ task }) { task.done = true; }
    export function App() {
      let tasks = [{ id: 1, done: false }];
      return <button onClick={() => mark({ task: tasks[0] })}>{tasks[0].done ? 'y' : 'n'}</button>;
    }`, true);
  expect(output).toMatch(/function mark\(\{ task \}\) \{\s*task\.done = true;\s*\}/);
});
