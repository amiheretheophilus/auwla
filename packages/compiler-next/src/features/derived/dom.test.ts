/** Native execution checks: call counts, ordering and const errors are observable. */
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
  const directory = join(import.meta.dirname, '../../../tests/out/memo-unit');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  const root = document.createElement('div');
  root.append(module.App('memo', null));
  document.body.append(root);
  mounted.push(root);
  const click = (selector = 'button') => root.querySelector<HTMLButtonElement>(selector)!.click();
  return { module, root, click };
}

it('recomputes a chain in order and skips unrelated updates and setup calls', async () => {
  const { module, root, click } = await compile(`
    export const log = [];
    function read(label, value) { log.push(label); return value; }
    export function App() {
      let count = 1, other = 0;
      const once = read('once', 3);
      const doubled = read('double', count * 2);
      const label = read('label', doubled + 1);
      return <main><p>{label}:{once}:{other}</p>
        <button id="more" onClick={() => count++}>more</button>
        <button id="other" onClick={() => other++}>other</button></main>;
    }`);
  click('#other');
  expect(module.log).toEqual(['once', 'double', 'label']);
  click('#more');
  expect(root.querySelector('p')!.textContent).toBe('5:3:1');
  expect(module.log).toEqual(['once', 'double', 'label', 'double', 'label']);
});

it('resets loop accumulators and preserves break, continue and switch control flow', async () => {
  const { root, click } = await compile(`export function App() {
    let limit = 3;
    let sum = 0;
    for (let i = 0; i < limit; i++) {
      if (i === 1) continue;
      if (i === 5) break;
      sum += i;
    }
    let label;
    switch (sum) { case 2: label = 'small'; break; default: label = String(sum); }
    return <main><p>{sum}:{label}</p><button onClick={() => limit += 3}>more</button></main>;
  }`);
  expect(root.querySelector('p')!.textContent).toBe('2:small');
  click();
  expect(root.querySelector('p')!.textContent).toBe('9:9');
  click();
  expect(root.querySelector('p')!.textContent).toBe('9:9');
});

it('runs shared body builders once and retains interleaved computation order', async () => {
  const { module, root, click } = await compile(`
    export const log = [];
    function record(name, value) { log.push(name + ':' + value); return value; }
    export function App() {
      let count = 1;
      let a = record('a', count), b = record('b', count * 2);
      if (count) { a += count; b += a; log.push('build'); }
      const middle = record('middle', a + b);
      a += middle;
      return <main><p>{a}:{b}:{middle}</p><button onClick={() => count++}>more</button></main>;
    }`);
  expect(root.querySelector('p')!.textContent).toBe('8:4:6');
  click();
  expect(root.querySelector('p')!.textContent).toBe('16:8:12');
  expect(module.log).toEqual(['a:1', 'b:2', 'build', 'middle:6', 'a:2', 'b:4', 'build', 'middle:12']);
});

it('resets an accumulator before a later-declared input is recomputed', async () => {
  const { root, click } = await compile(`export function App() {
    let count = 1;
    let sum = 0;
    const limit = count * 2;
    for (let i = 0; i < limit; i++) sum += i;
    return <main><p>{sum}</p><button onClick={() => count++}>more</button></main>;
  }`);
  expect(root.querySelector('p')!.textContent).toBe('1');
  click();
  expect(root.querySelector('p')!.textContent).toBe('6');
});

it('evaluates native pattern keys, defaults and rest once in order', async () => {
  const { module, root, click } = await compile(`
    export const log = [];
    function record(name, value) { log.push(name); return value; }
    export function App() {
      let count = 1;
      const { [record('key', 'missing')]: first = record('default', count), ...rest } = record('rhs', { extra: count + 1 });
      const [second = first, ...tail] = [undefined, rest.extra];
      return <main><p>{first}:{second}:{tail.join(',')}</p><button onClick={() => count++}>more</button></main>;
    }`);
  click();
  expect(root.querySelector('p')!.textContent).toBe('2:2:3');
  expect(module.log).toEqual(['rhs', 'key', 'default', 'rhs', 'key', 'default']);
});

it('keeps const assignment failures and coerces the current value for updates', async () => {
  const { module, root, click } = await compile(`
    export const log = [];
    export let assign, increment, pattern;
    export function App() {
      let count = 1;
      const value = { seed: count, valueOf() { log.push(this.seed); return this.seed; } };
      const number = count * 2;
      assign = () => { number = (log.push('rhs'), 10); };
      increment = () => value++;
      pattern = () => { ({ number } = { number: 20 }); };
      return <main><p>{number}</p><button onClick={() => count++}>more</button></main>;
    }`);
  click();
  expect(root.querySelector('p')!.textContent).toBe('4');
  expect(() => module.assign()).toThrow(TypeError);
  expect(() => module.increment()).toThrow(TypeError);
  expect(() => module.pattern()).toThrow(TypeError);
  expect(module.log).toEqual(['rhs', 2]);
  expect(root.querySelector('p')!.textContent).toBe('4');
});

it('retains lexical shadows and inferred function names on replay', async () => {
  const { root, click } = await compile(`export function App() {
    let count = 1;
    const value = count;
    const fn = count && function () {};
    function local() { const value = 40; return value; }
    return <main><p>{value}:{local()}:{fn.name}</p><button onClick={() => count++}>more</button></main>;
  }`);
  click();
  expect(root.querySelector('p')!.textContent).toBe('2:40:');
});

it('replays a visible helper builder without repeating it on the queued batch', async () => {
  const { module, root, click } = await compile(`
    export const log = [];
    export function App() {
      let count = 1;
      let total = 0;
      function build() { total += count; log.push(total); }
      build();
      return <main><p>{total}</p><button onClick={() => count++}>more</button></main>;
    }`);
  click();
  await Promise.resolve();
  expect(root.querySelector('p')!.textContent).toBe('2');
  expect(module.log).toEqual([1, 2]);
});

it('shares a declaration that also builds an earlier value', async () => {
  const { module, root, click } = await compile(`
    export const log = [];
    export function App() {
      let count = 1;
      let total = 0;
      const result = (log.push(count), total += count);
      return <main><p>{total}:{result}</p><button onClick={() => count++}>more</button></main>;
    }`);
  click();
  expect(root.querySelector('p')!.textContent).toBe('2:2');
  expect(module.log).toEqual([1, 2]);
});

it('keeps write commits in functions created by a replayed initializer', async () => {
  const { root, click } = await compile(`export function App() {
    let mode = 0, count = 0;
    const increment = mode ? () => count += 2 : () => count++;
    return <main><p>{count}</p><button id="mode" onClick={() => mode++}>mode</button>
      <button id="count" onClick={increment}>count</button></main>;
  }`);
  click('#count');
  expect(root.querySelector('p')!.textContent).toBe('1');
  click('#mode');
  click('#count');
  expect(root.querySelector('p')!.textContent).toBe('3');
});
