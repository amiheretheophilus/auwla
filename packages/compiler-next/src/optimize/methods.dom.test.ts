/** Lowered member calls keep native order and every edit the general path shows. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setScheduler } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../tests/harness/compilers';
import { compileModules } from '../pipeline';

const hosts: HTMLElement[] = [];
let sequence = 0;
afterEach(() => {
  clearCompiledApps();
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

function compile(source: string, optimize: boolean): string {
  return compileModules({ './App.tsx': source }, {
    runtimePath: '@memoized-dom/runtime/testing',
    optimize,
  })['./App.tsx']!;
}

async function mount(source: string, optimize: boolean) {
  const directory = join(import.meta.dirname, '../../tests/out/method-calls');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}-${optimize ? 'optimized' : 'general'}.js`);
  writeFileSync(file, compile(source, optimize));
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  host.append(module.App('method-calls', null));
  const click = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!.click();
  return { host, click, module };
}

const modes = [
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
];

it('marks only inline callbacks without explicit effects as proven', () => {
  const output = compile(`
    let total = 0;
    export function App() {
      let items = [1, 2, 3];
      const shown = items.map((item) => <li>{item * 2}</li>);
      const counted = items.map((item) => { total += item; return item; });
      const called = items.map((item) => String(item));
      const local = items.filter((item) => { let seen = item; seen++; return seen > 1; });
      return <ul onClick={() => { items = items.slice(1); }}>{shown}{counted}{called}{local}</ul>;
    }
  `, true);
  const proven = [...output.matchAll(/observeMethod\([^;]*?, "(\w+)", (\d+), /g)]
    .map(([, method, bits]) => `${method}:${bits}`);
  // Setup emits each derived call once, then the handler; replay repeats them.
  expect(proven.slice(0, 5)).toEqual(['map:1', 'map:0', 'map:0', 'filter:1', 'slice:0']);
  expect(compile('export function App() { let a = [1]; return <p onClick={() => { a = a.slice(1); }}>{a.length}</p>; }', false))
    .not.toContain('observeMethod');
});

it.each(modes)('updates for native array calls on state, read-only and editing ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    export function App() {
      let items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      return <main>
        <ul>{items.map((item) => <li key={item.id}>{item.id}</li>)}</ul>
        <button id="drop" onClick={() => { items = items.slice(1); }}>drop</button>
        <button id="reverse" onClick={() => { items.reverse(); }}>reverse</button>
        <button id="push" onClick={() => { items.push({ id: 9 }); }}>push</button>
        <button id="sort" onClick={() => { items.sort((a, b) => a.id - b.id); }}>sort</button>
      </main>;
    }
  `, optimize);
  const text = () => host.querySelector('ul')!.textContent;
  expect(text()).toBe('123');
  click('reverse');
  expect(text()).toBe('321');
  click('push');
  expect(text()).toBe('3219');
  click('sort');
  expect(text()).toBe('1239');
  click('drop');
  expect(text()).toBe('239');
});

it.each(modes)('shows edits by an overridden method and by an effectful callback ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    export function App() {
      let items = [{ n: 1 }, { n: 2 }];
      const special = [{ n: 5 }];
      special.slice = function () { this[0].n++; return []; };
      return <main>
        <p>{items.map((item) => item.n).join(',')}|{special[0].n}</p>
        <button id="bump" onClick={() => { items.map((item) => { item.n *= 10; return item; }); }}>bump</button>
        <button id="special" onClick={() => { special.slice(); }}>special</button>
      </main>;
    }
  `, optimize);
  const text = () => host.querySelector('p')!.textContent;
  expect(text()).toBe('1,2|5');
  click('bump');
  expect(text()).toBe('10,20|5');
  click('special');
  expect(text()).toBe('10,20|6');
});

it.each(modes)('evaluates receiver, method, arguments and call in native order ($mode)', async ({ optimize }) => {
  const { module, click } = await mount(`
    export const log = [];
    export function App() {
      let items = [1, 2, 3];
      const holder = { get list() { log.push('receiver'); return items; } };
      const at = (value) => { log.push('argument'); return value; };
      return <main>
        <p>{items.length}</p>
        <button id="go" onClick={() => { items = holder.list.slice(at(1)); log.push('done'); }}>go</button>
      </main>;
    }
  `, optimize);
  click('go');
  expect(module.log).toEqual(['receiver', 'argument', 'done']);
});
