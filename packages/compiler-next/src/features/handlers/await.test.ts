/** Check actual suspension boundaries before a test harness can drain microtasks. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setScheduler } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

let sequence = 0;
afterEach(clearCompiledApps);
async function compile(source: string) {
  const code = compileModules({ './App.tsx': source }, { runtimePath: '@memoized-dom/runtime/testing' })['./App.tsx']!;
  const directory = join(import.meta.dirname, '../../../tests/out/await-native');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  const root = module.App('await', null) as HTMLElement;
  return { root, module };
}

it('commits each stretch before two immediately resolved awaits', async () => {
  const { root, module } = await compile(`export let run;
    export function App() { let phase = 'idle';
      run = async () => { phase = 'first'; await 1; phase = 'second'; await 2; phase = 'done'; return 9; };
      return <p>{phase}</p>;
    }`);
  const pending = module.run();
  expect(root.textContent).toBe('first');
  await Promise.resolve();
  expect(root.textContent).toBe('second');
  expect(await pending).toBe(9);
  await Promise.resolve();
  expect(root.textContent).toBe('done');
});

it('keeps return await, receiver binding and one operand evaluation', async () => {
  const { root, module } = await compile(`export let run; export const log = [];
    const worker = { value: 4, async work() { log.push(this.value); return await Promise.resolve(this.value + 1); } };
    export function App() { let result = 0;
      run = async () => { result = await worker.work(); return result; };
      return <p>{result}</p>;
    }`);
  expect(await module.run()).toBe(5);
  await Promise.resolve();
  expect(module.log).toEqual([4]);
  expect(root.textContent).toBe('5');
});

it('observes a native mutation when the call has an awaited argument', async () => {
  const { root, module } = await compile(`export let run;
    export function App() { const items = [];
      run = async () => Array.prototype.push.call(items, await Promise.resolve(3));
      return <p>{items.join(',')}</p>;
    }`);
  expect(await module.run()).toBe(1);
  await Promise.resolve();
  expect(root.textContent).toBe('3');
});

it('recovers a partial opaque mutation if its call throws after an awaited argument', async () => {
  const { root, module } = await compile(`export let run;
    const opaque = { edit(items, value) { items.push(value); throw Error('after await'); } };
    export function App() { const items = [];
      run = async () => opaque.edit(items, await Promise.resolve(7));
      return <p>{items.join(',')}</p>;
    }`);
  await expect(module.run()).rejects.toThrow('after await');
  await Promise.resolve();
  expect(root.textContent).toBe('7');
});

it('restores the caller while an async factory is suspended', async () => {
  const { root } = await compile(`export function App() {
    let seed = 1, total = 0;
    async function begin() { let owned = 1; const read = () => owned; await 0; return read; }
    begin();
    function build() { total += seed; }
    build();
    return <main><p>{total}</p><button onClick={() => seed++}>more</button></main>;
  }`);
  await Promise.resolve();
  root.querySelector('button')!.click();
  expect(root.querySelector('p')!.textContent).toBe('2');
});
