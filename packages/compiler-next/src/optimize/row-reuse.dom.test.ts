/** Row reuse skips unchanged callbacks yet shows exactly what the general path shows. */
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
  const directory = join(import.meta.dirname, '../../tests/out/row-reuse');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}-${optimize ? 'optimized' : 'general'}.js`);
  writeFileSync(file, compile(source, optimize));
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  host.append(module.App('row-reuse', null));
  const click = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!.click();
  return { host, click, module };
}

const modes = [
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
];

it('allows reuse only for JSX-returning arrows that read tracked or constant values', () => {
  const caches = (callback: string, extra = '') => compile(`
    let shared = 1;
    const fixed = 2;
    ${extra}
    export function App({ prop }) {
      let local = 3;
      const items = [{ id: 1 }];
      return <ul onClick={() => { shared++; local++; }}>{items.map(${callback})}</ul>;
    }
  `, true).match(/createRowCache\((true|false)\)/g) ?? [];
  expect(caches('(item) => <li>{item.id}{shared}{fixed}</li>')).toEqual(['createRowCache(false)']);
  expect(caches('(item, index) => <li>{index}</li>')).toEqual(['createRowCache(true)']);
  expect(caches('(item) => { const label = item.id + fixed; return <li>{label}</li>; }')).toHaveLength(1);
  // Component state and props read in a callback are emitted as tracked reads.
  expect(caches('(item) => <li>{local}</li>')).toEqual(['createRowCache(false)']);
  expect(caches('(item) => <li>{prop}</li>')).toEqual(['createRowCache(false)']);
  // Returned objects must stay fresh.
  expect(caches('(item) => ({ id: item.id })')).toEqual([]);
  expect(caches('(item) => <li>{String(item.id)}</li>')).toEqual([]);
  expect(caches('(item, index, all) => <li>{all.length}</li>')).toEqual([]);
  expect(caches('function (item) { return <li>{item.id}</li>; }')).toEqual([]);
  expect(caches('(item) => <li>{changing}</li>', 'globalThis.changing = 1; changing = 2;')).toEqual([]);
  expect(compile('export function App() { const a = [1]; return <ul>{a.map((x) => <li>{x}</li>)}</ul>; }', false))
    .not.toContain('createRowCache');
});

it.each(modes)('follows component state and props read inside rows ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    function List({ prefix, items }) {
      let selected = 0;
      return <ul>{items.map((row) =>
        <li class={selected === row.id ? 'on' : ''} onClick={() => { selected = row.id; }}>{prefix}{row.id}</li>)}</ul>;
    }
    export function App() {
      let prefix = 'a';
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      return <main><List prefix={prefix} items={items} />
        <button id="prefix" onClick={() => { prefix = 'b'; }}>prefix</button></main>;
    }
  `, optimize);
  const list = () => [...host.querySelectorAll('li')].map((row) => `${row.className}|${row.textContent}`).join(' ');
  expect(list()).toBe('|a1 |a2 |a3');
  host.querySelectorAll('li')[1]!.click();
  expect(list()).toBe('|a1 on|a2 |a3');
  host.querySelectorAll('li')[0]!.click();
  expect(list()).toBe('on|a1 |a2 |a3');
  click('prefix');
  expect(list()).toBe('on|b1 |b2 |b3');
});

it.each(modes)('re-evaluates rows when a primitive item changes its zero sign ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    export function App() {
      let items = [0, -0];
      return <main><ul>{items.map((item) => <li>{1 / item}</li>)}</ul>
        <button id="swap" onClick={() => { items = [-0, 0]; }}>swap</button></main>;
    }
  `, optimize);
  const values = () => [...host.querySelectorAll('li')].map((row) => row.textContent);
  expect(values()).toEqual(['Infinity', '-Infinity']);
  click('swap');
  expect(values()).toEqual(['-Infinity', 'Infinity']);
});

it.each(modes)('shows in-place edits, replacements, moves, duplicates and tracked reads ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    let selected = 0;
    let suffix = '';
    const first = { id: 1, label: 'a' };
    let rows = [first, { id: 2, label: 'b' }, { id: 3, label: 'c' }];
    export function App() {
      let local = '';
      return <main>
        <ul>{rows.map((row, index) => <li class={selected === row.id ? 'on' : ''}>{index}:{row.label}{suffix}</li>)}</ul>
        <p>{rows.map((row) => <b>{row.label}{local}</b>)}</p>
        <button id="edit" onClick={() => { rows[1].label = 'B'; }}>edit</button>
        <button id="replace" onClick={() => { rows = [rows[0], { id: 2, label: 'new' }, rows[2]]; }}>replace</button>
        <button id="reverse" onClick={() => { rows = rows.toReversed(); }}>reverse</button>
        <button id="twice" onClick={() => { rows = [first, first]; }}>twice</button>
        <button id="select" onClick={() => { selected = 1; }}>select</button>
        <button id="suffix" onClick={() => { suffix = '!'; }}>suffix</button>
        <button id="local" onClick={() => { local = '?'; }}>local</button>
      </main>;
    }
  `, optimize);
  const list = () => [...host.querySelectorAll('li')].map((row) => `${row.className}|${row.textContent}`).join(' ');
  const bold = () => host.querySelector('p')!.textContent;
  expect(list()).toBe('|0:a |1:b |2:c');
  // Select a row that is not the last: every row's comparison reaches the list site.
  click('select');
  expect(list()).toBe('on|0:a |1:b |2:c');
  click('edit');
  expect(list()).toBe('on|0:a |1:B |2:c');
  click('replace');
  expect(list()).toBe('on|0:a |1:new |2:c');
  click('reverse');
  expect(list()).toBe('|0:c |1:new on|2:a');
  click('suffix');
  expect(list()).toBe('|0:c! |1:new! on|2:a!');
  click('local');
  expect(bold()).toBe('c?new?a?');
  click('twice');
  expect(list()).toBe('on|0:a! on|1:a!');
  expect(bold()).toBe('a?a?');
});
