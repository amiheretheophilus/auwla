/** Takeover checks against native execution, including partial writes and calls. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findAll } from 'yuku-ast';
import { parse } from 'yuku-parser';
import { setScheduler } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

let sequence = 0;
const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) root.remove();
  clearCompiledApps();
});

async function compile(source: string) {
  const code = compileModules({ './App.tsx': source }, { runtimePath: '@memoized-dom/runtime/testing' })['./App.tsx']!;
  const parsed = parse(code, { lang: 'js', sourceType: 'module' });
  expect(parsed.diagnostics).toEqual([]);
  expect(findAll(parsed.program, 'TryStatement')).toHaveLength(0);
  const directory = join(import.meta.dirname, '../../../tests/out/takeover-unit');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  const root = document.createElement('div');
  root.append(module.App('takeover', null));
  document.body.append(root);
  mounted.push(root);
  const click = (selector: string) => root.querySelector<HTMLButtonElement>(selector)!.click();
  const text = () => root.querySelector('p')!.textContent;
  return { module, root, click, text };
}

it('does not rerun downstream calls when a taken input stops changing', async () => {
  const { module, click, text } = await compile(`
    export const log = [];
    function record(value) { log.push(value); return value; }
    export function App() {
      let count = 1;
      let total = count * 2;
      const shown = record(total);
      return <main><p>{shown}</p><button id="count" onClick={() => count++}>more</button>
        <button id="take" onClick={() => total = 10}>take</button></main>;
    }`);
  click('#count');
  click('#take');
  click('#count');
  expect(text()).toBe('10');
  expect(module.log).toEqual([2, 4, 10]);
});

it('keeps synchronous helper writes as builders until the helper runs later', async () => {
  const { click, text } = await compile(`export function App() {
    let count = 1;
    let total = 0;
    function build() { total += count; }
    build();
    return <main><p>{total}</p><button id="count" onClick={() => count++}>more</button>
      <button id="take" onClick={build}>take</button></main>;
  }`);
  expect(text()).toBe('1');
  click('#count');
  expect(text()).toBe('2');
  click('#take');
  expect(text()).toBe('4');
  click('#count');
  expect(text()).toBe('4');
});

it('keeps the taken output of a pattern while its sibling follows the source', async () => {
  const { click, text } = await compile(`export function App() {
    let point = { a: 1, b: 2 };
    let { a, b } = point;
    return <main><p>{a}:{b}</p><button id="point" onClick={() => point = { a: 3, b: 4 }}>move</button>
      <button id="take" onClick={() => a = 99}>take</button></main>;
  }`);
  click('#take');
  click('#point');
  expect(text()).toBe('99:4');
});

it('takes over only the completed targets when a later pattern getter throws', async () => {
  const { module, click, text } = await compile(`
    export let run;
    export function App() {
      let seed = 1;
      let a = seed, b = seed * 2;
      run = () => { ({ a, b } = { a: 99, get b() { throw new Error('later'); } }); };
      return <main><p>{a}:{b}</p><button id="seed" onClick={() => seed++}>more</button></main>;
    }`);
  expect(() => module.run()).toThrow('later');
  await Promise.resolve();
  expect(text()).toBe('99:2');
  click('#seed');
  expect(text()).toBe('99:4');
});

it('stops an exclusive builder while a shared sibling still replays', async () => {
  const { module, click, text } = await compile(`
    export const log = [];
    export function App() {
      let seed = 1;
      let a = 0, b = 0;
      if (seed) { a = seed; b = seed * 2; }
      if (seed) { a += 1; log.push('a'); }
      return <main><p>{a}:{b}</p><button id="seed" onClick={() => seed++}>more</button>
        <button id="take" onClick={() => a = 99}>take</button></main>;
    }`);
  click('#take');
  click('#seed');
  expect(text()).toBe('99:4');
  expect(module.log).toEqual(['a']);
});

it('takes over loop targets only when a native loop assigns them', async () => {
  const { click, text } = await compile(`export function App() {
    let seed = 1;
    let a = seed, b = seed * 2;
    return <main><p>{a}:{b}</p><button id="seed" onClick={() => seed++}>more</button>
      <button id="empty" onClick={() => { for (a of []) {} }}>empty</button>
      <button id="take" onClick={() => { for (b of [50]) {} }}>take</button></main>;
  }`);
  click('#empty');
  click('#seed');
  expect(text()).toBe('2:4');
  click('#take');
  click('#seed');
  expect(text()).toBe('3:50');
});

it('treats a nested component body as another owner and restores the parent', async () => {
  const { click, text } = await compile(`
    let change;
    function Child() { change(); return <span>child</span>; }
    export function App() {
      let seed = 1;
      let total = seed * 2;
      let other = 0;
      function build() { other += seed; }
      change = () => total = 99;
      Child();
      build();
      return <main><p>{total}:{other}</p><button id="seed" onClick={() => seed++}>more</button></main>;
    }`);
  expect(text()).toBe('99:1');
  click('#seed');
  expect(text()).toBe('99:2');
});

it('stops a builder of one pattern alias while another alias still derives', async () => {
  const { module, click, text } = await compile(`
    export const log = [];
    export function App() {
      let seed = 1;
      let { a, b } = { a: seed, b: seed * 2 };
      if (seed) { a += 1; log.push('a'); }
      return <main><p>{a}:{b}</p><button id="seed" onClick={() => seed++}>more</button>
        <button id="take" onClick={() => a = 99}>take</button></main>;
    }`);
  click('#take');
  click('#seed');
  expect(text()).toBe('99:4');
  expect(module.log).toEqual(['a']);
});

it('resets an accumulator built by an opaque call in a variable initializer', async () => {
  const { click, text } = await compile(`const invoke = { now(fn) { fn(); return 7; } };
    export function App() {
      let seed = 1, total = 0;
      const result = invoke.now(() => { total += seed; });
      return <main><p>{total}:{result}</p><button id="seed" onClick={() => seed++}>more</button></main>;
    }`);
  expect(text()).toBe('1:7');
  click('#seed');
  expect(text()).toBe('2:7');
  click('#seed');
  expect(text()).toBe('3:7');
});

it('does not repeat a registration initializer when its callback did not build the output', async () => {
  const { module, click, text } = await compile(`
    export const registrations = []; let saved;
    const registry = { register(fn) { registrations.push('registered'); saved = fn; return 7; } };
    export function App() {
      let seed = 1, total = seed * 2;
      const handle = registry.register(() => { total = 99; });
      return <main><p>{total}:{handle}</p><button id="seed" onClick={() => seed++}>more</button></main>;
    }`);
  click('#seed');
  click('#seed');
  expect(text()).toBe('6:7');
  expect(module.registrations).toEqual(['registered']);
});
