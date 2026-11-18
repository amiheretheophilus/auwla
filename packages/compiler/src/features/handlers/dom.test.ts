/** Native execution checks for write semantics that a rerendering oracle can hide. */
import { afterEach, expect, it } from 'bun:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { findAll } from 'yuku-ast';
import { parse } from 'yuku-parser';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { setScheduler } from '@memoized-dom/runtime/testing';
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
  // Bun's data-URL importer does not expose these module exports consistently.
  // Use the same on-disk execution path as the comparison harness.
  const directory = join(import.meta.dirname, '../../../tests/out/handler-unit');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  const mount = (id: string) => {
    const root = document.createElement('div');
    root.append(module.App(id, null));
    document.body.append(root);
    mounted.push(root);
    return root;
  };
  return { module, mount };
}

it('does not invoke an unrelated site or no-op logical assignment again', async () => {
  const { module, mount } = await compile(`
    export const observations = [];
    export function App() {
      let count = 0, stable = 1;
      function read(value) { observations.push(value); return value; }
      return <main><p>{read(stable)}</p><output>{count}</output>
        <button id="count" onClick={() => count++}>count</button>
        <button id="noop" onClick={() => stable ||= 9}>noop</button>
        <button id="change" onClick={() => stable = 2}>change</button></main>;
    }`);
  const root = mount('one');
  root.querySelector<HTMLButtonElement>('#count')!.click();
  root.querySelector<HTMLButtonElement>('#noop')!.click();
  expect(module.observations).toEqual([1]);
  root.querySelector<HTMLButtonElement>('#change')!.click();
  expect(module.observations).toEqual([1, 2]);
  expect(root.querySelector('output')!.textContent).toBe('1');
});

it('keeps each invocation state and versions separate', async () => {
  const { mount } = await compile(`export function App() {
    let count = 0;
    return <button onClick={() => count++}>{count}</button>;
  }`);
  const first = mount('first');
  const second = mount('second');
  first.querySelector('button')!.click();
  expect(first.textContent).toBe('1');
  expect(second.textContent).toBe('0');
  expect(first.firstChild).not.toBe(second.firstChild);
});

it('preserves typed text when a same-value write leaves the property unchanged', async () => {
  const { mount } = await compile(`export function App() {
    let value = 'initial';
    return <main><input value={value} /><button onClick={() => value = 'initial'}>same</button></main>;
  }`);
  const root = mount('one');
  const input = root.querySelector('input')!;
  input.value = 'typed';
  root.querySelector('button')!.click();
  expect(input.value).toBe('typed');
});

it('preserves lexical shadows in nested functions and the outer write result', async () => {
  const { mount } = await compile(`export function App() {
    let count = 0;
    function local() { let count = 40; return ++count; }
    return <button onClick={() => count = local()}>{count}</button>;
  }`);
  const root = mount('one');
  root.querySelector('button')!.click();
  expect(root.textContent).toBe('41');
});

it('reports a completed destructuring target when a later getter throws', async () => {
  const { module, mount } = await compile(`
    export let run;
    export function App() {
      let first = 0, second = 0;
      run = () => { ({ first, second } = { first: 7, get second() { throw new Error('later'); } }); };
      return <p>{first}:{second}</p>;
    }`);
  const root = mount('one');
  expect(() => module.run()).toThrow('later');
  await Promise.resolve();
  expect(root.textContent).toBe('7:0');
});

it('preserves shorthand defaults and rest in native patterns', async () => {
  const { module, mount } = await compile(`
    export let run;
    export function App() {
      let first = 0, rest = [];
      run = () => { ({ first = 3 } = {}); [first, ...rest] = [first, 4, 5]; };
      return <p>{first}:{rest.join(',')}</p>;
    }`);
  const root = mount('one');
  module.run();
  await Promise.resolve();
  expect(root.textContent).toBe('3:4,5');
});

it('keeps destructuring setters inside the target binding lexical scope', async () => {
  const { module, mount } = await compile(`
    export let run;
    export function App() {
      let output = '';
      {
        let count = 0;
        run = () => { [count] = [count + 1]; output = String(count); };
      }
      return <p>{output}</p>;
    }`);
  const root = mount('one');
  module.run();
  await Promise.resolve();
  expect(root.textContent).toBe('1');
  module.run();
  await Promise.resolve();
  expect(root.textContent).toBe('2');
});
