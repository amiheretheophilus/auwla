/** Capture layout must retain native evaluation order and authored value shape. */
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

async function compile(source: string, optimize: boolean) {
  const code = compileModules({ './App.tsx': source }, {
    runtimePath: '@memoized-dom/runtime/testing',
    optimize,
  })['./App.tsx']!;
  const directory = join(import.meta.dirname, '../../tests/out/packed-captures-native');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}.js`);
  writeFileSync(file, code);
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  return { module, host };
}

const modes = [
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
];

it.each(modes)('evaluates a stored root key at its authored attribute position ($mode)', async ({ optimize }) => {
  const { module, host } = await compile(`
    export const log = [];
    function read(name, value) {
      log.push(name);
      return value;
    }
    export function App() {
      return <ul>{[
        <li title={read('before', 'a')} key={read('key', 'row')}
          data-after={read('after', 'b')}>{read('child', 'body')}</li>
      ]}</ul>;
    }
  `, optimize);
  host.append(module.App('capture-order', null));
  expect(host.textContent).toBe('body');
  expect(module.log).toEqual(['before', 'key', 'after', 'child']);
});

it.each(modes)('retains the final duplicate key and evaluates the earlier one ($mode)', async ({ optimize }) => {
  const { module, host } = await compile(`
    export const log = [];
    function read(value) {
      log.push(value);
      return value;
    }
    export function App() {
      let first = 0;
      return <main><ul>{[
        <li key={read(first)} key="stable">body</li>
      ]}</ul><button onClick={() => first++}>inc</button></main>;
    }
  `, optimize);
  host.append(module.App('duplicate-key', null));
  const first = host.querySelector('li')!;
  expect(module.log).toEqual([0]);
  host.querySelector<HTMLButtonElement>('button')!.click();
  expect(module.log).toEqual([0, 1]);
  // Compare identity without dumping happy-dom's entire document on failure.
  expect(host.querySelector('li') === first).toBe(true);
});

it.each(modes)('stops before later attributes and children when a key throws ($mode)', async ({ optimize }) => {
  const { module } = await compile(`
    export const log = [];
    function read(name) {
      log.push(name);
      if (name === 'key') throw new Error('native key failure');
      return name;
    }
    export function App() {
      return <ul>{[
        <li title={read('before')} key={read('key')}
          data-after={read('after')}>{read('child')}</li>
      ]}</ul>;
    }
  `, optimize);
  expect(() => module.App('throwing-key', null)).toThrow('native key failure');
  expect(module.log).toEqual(['before', 'key']);
});

it.each(modes)('evaluates explicit children before overriding them with JSX children ($mode)', async ({ optimize }) => {
  const { module, host } = await compile(`
    export const log = [];
    function read(name) {
      log.push(name);
      return name;
    }
    export function App() {
      return <div children={read('attribute')}>{read('child')}</div>;
    }
  `, optimize);
  host.append(module.App('children-order', null));
  expect(host.textContent).toBe('child');
  expect(module.log).toEqual(['attribute', 'child']);
});
