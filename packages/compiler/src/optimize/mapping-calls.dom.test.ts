/**
 * `Array.from(items, row)` gets the row list and row cache that `items.map(row)`
 * gets (`mapping-calls.ts`), and shows exactly what the general path shows: the
 * items `Array.from` iterates, holes as `undefined`, with the same row identity.
 */
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
  for (const host of hosts.splice(0)) host.remove();
});

function compile(source: string, optimize: boolean): string {
  return compileModules({ './App.tsx': source }, { runtimePath: '@memoized-dom/runtime/testing', optimize })['./App.tsx']!;
}

async function mount(source: string, optimize: boolean) {
  const directory = join(import.meta.dirname, '../../tests/out/mapping-calls');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}-${optimize ? 'optimized' : 'general'}.js`);
  writeFileSync(file, compile(source, optimize));
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  host.append(module.App('mapping-calls', null));
  return host;
}

/** Each step's rows as `node:text`, where node numbers the DOM elements in order of first appearance. */
async function trace(source: string, optimize: boolean, steps: number): Promise<string[]> {
  const host = await mount(source, optimize);
  const ids = new WeakMap<Element, number>();
  let next = 0;
  const shown = () => [...host.querySelectorAll('li')].map((row) => {
    if (!ids.has(row)) ids.set(row, ++next);
    return `${ids.get(row)}:${row.textContent}`;
  }).join(' ');
  const result = [shown()];
  for (let step = 0; step < steps; step++) {
    host.querySelector<HTMLElement>('#next')!.click();
    result.push(shown());
  }
  return result;
}

/** What the compiled module uses to show its list. */
function strategy(source: string): string {
  const output = compile(source, true);
  if (output.includes('createRowList(')) return /_rowList\d*\.from\(/.test(output) ? 'row list (from)' : 'row list';
  if (output.includes('fromRows(')) return 'row cache (from)';
  if (output.includes('mapRows(')) return 'row cache';
  return 'general';
}

it('recognizes only the intrinsic Array.from with an items argument and a row callback', () => {
  const app = (list: string, extra = '') => `
    let rows = [{ id: 1 }];
    ${extra}
    export function App() {
      return <main><ul>{${list}}</ul><button onClick={() => { rows = []; }}>clear</button></main>;
    }`;
  expect(strategy(app('Array.from(rows, (row) => <li key={row.id}>{row.id}</li>)'))).toBe('row list (from)');
  expect(strategy(app('Array.from(rows, (row, index) => <><li>{index}</li><li>{row.id}</li></>)'))).toBe('row cache (from)');
  expect(strategy(app('rows.map((row) => <li key={row.id}>{row.id}</li>)'))).toBe('row list');
  // Not the shape: no callback, an extra `this` argument, an optional call, a spread.
  expect(strategy(app('Array.from(rows)'))).toBe('general');
  expect(strategy(app('Array.from(rows, (row) => <li>{row.id}</li>, null)'))).toBe('general');
  expect(strategy(app('Array.from?.(rows, (row) => <li>{row.id}</li>)'))).toBe('general');
  expect(strategy(app('Array.from(...[rows, (row) => <li>{row.id}</li>])'))).toBe('general');
  // Not the intrinsic: a local `Array`, an assigned global, a module-defined `from`.
  expect(strategy(app('Array.from(rows, (row) => <li>{row.id}</li>)', 'const Array = { from: (items, f) => items.map(f) };'))).toBe('general');
  expect(strategy(app('Array.from(rows, (row) => <li>{row.id}</li>)', 'Array = globalThis.Array;'))).toBe('general');
  expect(strategy(app('Array.from(rows, (row) => <li>{row.id}</li>)', 'const other = { from(x) { return x; } };'))).toBe('general');
  // The callback's own proof still applies (`row-reuse.ts`).
  expect(strategy(app('Array.from(rows, (row) => <li>{Math.random()}</li>)'))).toBe('general');
});

const steps = `
  let rows = [{ id: 1, l: 'a' }, { id: 2, l: 'b' }, { id: 3, l: 'c' }];
  const changes = [
    () => { rows = [rows[2], rows[0], rows[1]]; },
    () => { rows = [rows[0], rows[0], rows[1]]; },
    () => { rows = [{ id: 1, l: 'x' }, ...rows]; },
    () => { const holes = []; holes[2] = { id: 9, l: 'h' }; holes[0] = { id: 8, l: 'g' }; rows = holes; },
    () => { rows = [{ id: '1', l: 's' }, { id: 1, l: 'n' }, { id: null, l: 'z' }]; },
    () => { rows.reverse(); },
    () => { rows.splice(1, 1); },
    () => { rows[0].l = 'edited'; },
    () => { rows = new Set([{ id: 6, l: 'set' }, rows[0]]); },
    () => { rows = { length: 2, 0: { id: 7, l: 'like' } }; },
    () => { rows = []; },
    () => { rows = [{ id: 5, l: 'e' }]; },
  ];
  let step = 0;
`;

// Holes, a set and an array-like are what `Array.from` iterates, unlike `map`: a hole is an
// `undefined` item, so these rows read it with `?.`.
it.each([
  '<li key={row?.id}>{row?.l}</li>',
  '<li>{row?.l}</li>',
  '<li key={row?.id}>{index}{row?.l}</li>',
  '<><li>{index}</li><li>{row?.l}</li></>',
])('keeps the general path\'s rows and identity through moves, holes, iterables and edits: %s', async (row) => {
  const source = `${steps}
    export function App() {
      return <main><ul>{Array.from(rows, (row, index) => ${row})}</ul>
        <button id="next" onClick={() => { changes[step++](); }}>next</button></main>;
    }`;
  expect(strategy(source)).not.toBe('general');
  const optimized = await trace(source, true, 12);
  const general = await trace(source, false, 12);
  expect(optimized).toEqual(general);
});

it.each([true, false])('iterates sets, map values, generators, strings, array-likes and replaced iterators (optimize: %p)', async (optimize) => {
  const source = `
    function* numbers() { yield 4; yield 5; }
    const sources = [
      () => new Map([['a', 1], ['b', 2]]).values(),
      () => numbers(),
      () => 'hé',
      () => ({ length: 3, 1: 'one' }),
      () => { const odd = [1, 2, 3]; odd[Symbol.iterator] = function* () { yield 9; }; return odd; },
    ];
    let items = new Set([1, 2, 2, 3]);
    let step = 0;
    export function App() {
      return <main><ul>{Array.from(items, (item, index) => <li key={index}>{String(item)}</li>)}</ul>
        <button id="next" onClick={() => { items = sources[step++](); }}>next</button></main>;
    }`;
  expect(strategy(source)).toBe('row list (from)');
  const host = await mount(source, optimize);
  const shown: string[] = [];
  for (let step = 0; step < 6; step++) {
    if (step > 0) host.querySelector<HTMLElement>('#next')!.click();
    shown.push([...host.querySelectorAll('li')].map((row) => row.textContent).join(','));
  }
  expect(shown).toEqual(['1,2,3', '1,2', '4,5', 'h,é', 'undefined,one,undefined', '9']);
});
