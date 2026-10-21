/** Native branch identity, lazy evaluation and placement checks. */
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
  expect(findAll(parsed.program, ['TryStatement', 'JSXElement', 'JSXFragment'])).toHaveLength(0);
  const directory = join(import.meta.dirname, '../../../tests/out/conditional-unit');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  const root = document.createElement('div');
  root.append(module.App('conditional', null));
  document.body.append(root);
  mounted.push(root);
  return { root, module, click: (selector: string) => root.querySelector<HTMLButtonElement>(selector)!.click() };
}

it('updates a bare returned conditional and preserves its root range on a swap', async () => {
  const { root, module, click } = await compile(`export let show = true, count = 1;
    export function toggle() { show = !show; }
    export function App() { return show ? <button id="inc" onClick={() => count++}>{count}</button> : <i>off</i>; }`);
  const button = root.querySelector('button');
  click('#inc');
  expect(root.querySelector('button')).toBe(button);
  expect(root.textContent).toBe('2');
  module.toggle();
  await Promise.resolve();
  expect(root.textContent).toBe('off');
  module.toggle();
  await Promise.resolve();
  expect(root.textContent).toBe('2');
  expect(root.querySelector('button')).not.toBe(button);
});

it('accepts expression-bodied arrows returning logical markup or zero', async () => {
  const { root, module, click } = await compile(`export let count = 0;
    export function start() { count = 1; }
    export const App = () => count && <button id="clear" onClick={() => count = 0}>{count}</button>;`);
  expect(root.textContent).toBe('0');
  module.start();
  await Promise.resolve();
  expect(root.querySelector('button')!.textContent).toBe('1');
  click('#clear');
  expect(root.textContent).toBe('0');
});

it('folds early returns while retaining component state across branch swaps', async () => {
  const { root, click } = await compile(`export function App() {
    let show = false, count = 1;
    if (!show) return <button id="open" onClick={() => show = true}>open</button>;
    return <main><p>{count}</p><button id="inc" onClick={() => count++}>inc</button>
      <button id="close" onClick={() => show = false}>close</button></main>;
  }`);
  expect(root.textContent).toBe('open');
  click('#open');
  click('#inc');
  expect(root.querySelector('p')!.textContent).toBe('2');
  click('#close');
  expect(root.textContent).toBe('open');
  click('#open');
  expect(root.querySelector('p')!.textContent).toBe('2');
});

it('retains the same fallthrough markup reached by different nested return paths', async () => {
  const { root, click } = await compile(`export function App() {
    let a = false, b = false;
    if (a) { if (b) return <button id="back" onClick={() => b = false}>selected</button>; }
    return <main><p>fallback</p><button id="a" onClick={() => a = !a}>a</button>
      <button id="b" onClick={() => b = !b}>b</button></main>;
  }`);
  const p = root.querySelector('p');
  click('#a');
  expect(root.querySelector('p')).toBe(p);
  click('#b');
  expect(root.textContent).toBe('selected');
  click('#back');
  expect(root.querySelector('p')!.textContent).toBe('fallback');
});

it('retains a selected branch, updates its sites and replaces it only on a switch', async () => {
  const { root, click } = await compile(`export function App() {
    let show = true, count = 1;
    return <main><span>before</span>{show ? <section><p>{count}</p><input value="start" /></section> : <b>off</b>}
      <span>after</span><button id="inc" onClick={() => count++}>inc</button>
      <button id="toggle" onClick={() => show = !show}>toggle</button></main>;
  }`);
  const section = root.querySelector('section');
  root.querySelector('input')!.value = 'typed';
  click('#inc');
  expect(root.querySelector('section')).toBe(section);
  expect(root.querySelector('p')!.textContent).toBe('2');
  expect(root.querySelector('input')!.value).toBe('typed');
  expect(root.querySelector('main')!.textContent).toBe('before2afterinctoggle');
  click('#toggle');
  expect(root.querySelector('section')).toBeNull();
  expect(root.querySelector('b')!.textContent).toBe('off');
  click('#toggle');
  expect(root.querySelector('section')).not.toBe(section);
  expect(root.querySelector('input')!.value).toBe('start');
  expect(root.querySelector('p')!.textContent).toBe('2');
});

it('keeps inactive attributes lazy and evaluates a selector only when its inputs change', async () => {
  const { root, module, click } = await compile(`export const log = [];
    function choose(show) { log.push('choose'); return show; }
    function attribute(count) { log.push('attribute:' + count); return count; }
    export function App() {
      let show = false, count = 1;
      return <main>{choose(show) ? <b title={attribute(count)}>{count}</b> : <i>off</i>}
        <button id="inc" onClick={() => count++}>inc</button>
        <button id="toggle" onClick={() => show = !show}>toggle</button></main>;
    }`);
  expect(module.log).toEqual(['choose']);
  click('#inc');
  expect(module.log).toEqual(['choose']);
  click('#toggle');
  expect(module.log).toEqual(['choose', 'choose', 'attribute:2']);
  const branch = root.querySelector('b');
  click('#inc');
  expect(root.querySelector('b')).toBe(branch);
  expect(root.querySelector('b')!.title).toBe('3');
  expect(module.log).toEqual(['choose', 'choose', 'attribute:2', 'attribute:3']);
});

it('preserves logical falsy values and evaluates each left operand once', async () => {
  const { root, module, click } = await compile(`export const log = [];
    function left(value) { log.push(value); return value; }
    export function App() {
      let value = 0;
      return <main><p>{left(value) && <b>{value}</b>}</p>
        <button id="inc" onClick={() => value++}>inc</button></main>;
    }`);
  expect(root.querySelector('p')!.textContent).toBe('0');
  expect(module.log).toEqual([0]);
  click('#inc');
  const branch = root.querySelector('b');
  expect(root.querySelector('p')!.textContent).toBe('1');
  expect(module.log).toEqual([0, 1]);
  click('#inc');
  expect(root.querySelector('b')).toBe(branch);
  expect(root.querySelector('p')!.textContent).toBe('2');
  expect(module.log).toEqual([0, 1, 2]);
});

it('updates nested regions and conditional fragment roots in authored order', async () => {
  const { root, click } = await compile(`export function App() {
    let a = true, b = true;
    return <>{a ? <><p>{b ? <b>yes</b> : <i>no</i>}</p><span>end</span></> : 'off'}
      <button id="a" onClick={() => a = !a}>a</button>
      <button id="b" onClick={() => b = !b}>b</button></>;
  }`);
  expect(root.textContent).toBe('yesendab');
  const p = root.querySelector('p');
  click('#b');
  expect(root.querySelector('p')).toBe(p);
  expect(root.textContent).toBe('noendab');
  click('#a');
  expect(root.textContent).toBe('offab');
  click('#a');
  expect(root.textContent).toBe('noendab');
});

it('keeps conditional SVG branches in their inherited namespace', async () => {
  const { root, click } = await compile(`export function App() {
    let show = true;
    return <main><svg>{show ? <circle r="2" /> : <path d="M0 0" />}</svg>
      <button id="toggle" onClick={() => show = !show}>toggle</button></main>;
  }`);
  expect(root.querySelector('circle')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
  click('#toggle');
  expect(root.querySelector('path')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
});

it('renders nullish and or fallbacks without evaluating inactive markup', async () => {
  const { root, click } = await compile(`export function App() {
    let value = null;
    return <main><p>{value ?? <b>none</b>}:{value || <i>empty</i>}</p>
      <button id="set" onClick={() => value = 0}>set</button></main>;
  }`);
  expect(root.querySelector('p')!.textContent).toBe('none:empty');
  click('#set');
  expect(root.querySelector('p')!.textContent).toBe('0:empty');
  expect(root.querySelector('b')).toBeNull();
});
