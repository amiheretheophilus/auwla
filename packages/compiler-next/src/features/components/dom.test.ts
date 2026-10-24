/** Native observations complement the independently rerendering reference. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findAll } from 'yuku-ast';
import { parse } from 'yuku-parser';
import { registeredIds, setScheduler, unregisterSubtree } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

let sequence = 0;
const mounted: HTMLElement[] = [];

afterEach(() => {
  clearCompiledApps();
  for (const root of mounted.splice(0)) {
    root.remove();
  }
});

async function compile(source: string) {
  const code = compileModules({ './App.tsx': source }, {
    runtimePath: '@memoized-dom/runtime/testing',
  })['./App.tsx']!;
  const parsed = parse(code, { lang: 'js', sourceType: 'module' });
  expect(parsed.diagnostics).toEqual([]);
  expect(findAll(parsed.program, ['TryStatement', 'JSXElement', 'JSXFragment'])).toHaveLength(0);
  const directory = join(import.meta.dirname, '../../../tests/out/components-unit');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  const root = document.createElement('div');
  root.append(module.App('components', null));
  document.body.append(root);
  mounted.push(root);
  const click = (selector: string) => root.querySelector<HTMLButtonElement>(selector)!.click();
  return { module, root, click };
}

it('evaluates tag and spread getters once in order and excludes reserved props', async () => {
  const { module, root } = await compile(`
    export const seen = [];
    function Child(props) { return <p>{Object.keys(props).sort().join(',')}</p>; }
    const UI = { get Child() { seen.push('tag'); return Child; } };
    const props = { get value() { seen.push('spread'); return 1; } };
    function key() { seen.push('key'); return 'row'; }
    function tail() { seen.push('tail'); return 2; }
    export function App() {
      return <UI.Child {...props} key={key()} extra={tail()} />;
    }
  `);
  expect(module.seen).toEqual(['tag', 'spread', 'key', 'tail']);
  expect(root.querySelector('p')?.textContent).toBe('extra,value');
});

it('removes child registrations and dependencies when a subtree leaves', async () => {
  const { root, click } = await compile(`
    export const reads = [];
    let shared = 0;
    function Child() {
      function read() { reads.push(shared); return shared; }
      return <p>{read()}</p>;
    }
    export function App() {
      let visible = true;
      return <main>{visible && <Child />}
        <button id="hide" onClick={() => { visible = false; }}>hide</button>
        <button id="inc" onClick={() => shared++}>inc</button></main>;
    }
  `);
  const before = registeredIds().length;
  click('#hide');
  expect(root.querySelector('p')).toBeNull();
  expect(registeredIds().length).toBeLessThan(before);
  click('#inc');
  expect(root.querySelector('p')).toBeNull();
  unregisterSubtree('components');
  expect(registeredIds()).toEqual([]);
});

it('mounts component-produced SVG in the consuming namespace', async () => {
  const { root, click } = await compile(`
    function Shape({ radius }) { return <circle r={radius} />; }
    export function App() {
      let radius = 1;
      return <main><svg><Shape radius={radius} /></svg>
        <button id="inc" onClick={() => radius++}>inc</button></main>;
    }
  `);
  const circle = root.querySelector('circle')!;
  expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');
  click('#inc');
  expect(root.querySelector('circle')).toBe(circle);
  expect(circle.getAttribute('r')).toBe('2');
});

it('runs a discarded component call for its setup', async () => {
  const { module } = await compile(`
    export const seen = [];
    function Child(value) { seen.push(value); return <p>{value}</p>; }
    export function App() { Child(7); return <main>done</main>; }
  `);
  expect(module.seen).toEqual([7]);
});

it('preserves map arguments, rest parameters and parameter defaults in component values', async () => {
  const { root, click } = await compile(`
    function Row(value, index = 9, ...rest) {
      return <li>{value}:{index}:{rest.length}</li>;
    }
    export function App() {
      let items = [1, 2];
      return <main><ul>{items.map(Row)}</ul><ol>{Row(8)}</ol>
        <button id="add" onClick={() => items.push(3)}>add</button></main>;
    }
  `);
  expect(root.querySelector('ul')?.textContent).toBe('1:0:12:1:1');
  expect(root.querySelector('ol')?.textContent).toBe('8:9:0');
  click('#add');
  expect(root.querySelector('ul')?.textContent).toBe('1:0:12:1:13:2:1');
});

it('leaves unused getters untouched in direct component arguments', async () => {
  const { module, root } = await compile(`
    export const reads = [];
    function Child({ value }) { return <p>{value}</p>; }
    export function App() {
      const props = { value: 1, get unused() { reads.push('unused'); return 2; } };
      return <main>{Child(props)}</main>;
    }
  `);
  expect(module.reads).toEqual([]);
  expect(root.querySelector('p')?.textContent).toBe('1');
});

it('invokes opaque dynamic tags as ordinary callables', async () => {
  const { root, click } = await compile(`
    function make(prefix) { return ({ value }) => <p>{prefix}:{value}</p>; }
    export function App() {
      let value = 1;
      const Tag = make('native');
      return <main><Tag value={value} /><button id="inc" onClick={() => value++}>inc</button></main>;
    }
  `);
  expect(root.querySelector('p')?.textContent).toBe('native:1');
  click('#inc');
  expect(root.querySelector('p')?.textContent).toBe('native:2');
});

it('inherits SVG through conditional fragments and restarts HTML in foreignObject', async () => {
  const { root, click } = await compile(`
    function Shape({ shown }) {
      return <>{shown ? <circle /> : <g />}<foreignObject><div>html</div></foreignObject></>;
    }
    export function App() {
      let shown = true;
      return <main><svg><Shape shown={shown} /></svg>
        <button id="toggle" onClick={() => { shown = !shown; }}>toggle</button></main>;
    }
  `);
  expect(root.querySelector('circle')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(root.querySelector('foreignObject')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
  expect(root.querySelector('div')?.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
  click('#toggle');
  expect(root.querySelector('circle')).toBeNull();
  expect(root.querySelector('g')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
});

it('tracks module-owned dynamic tags even when their props stay unchanged', async () => {
  const { root, click } = await compile(`
    let Tag = 'h2';
    export function App() {
      return <main><Tag>value</Tag>
        <button id="change" onClick={() => { Tag = 'p'; }}>change</button></main>;
    }
  `);
  expect(root.querySelector('h2')?.textContent).toBe('value');
  click('#change');
  expect(root.querySelector('h2')).toBeNull();
  expect(root.querySelector('p')?.textContent).toBe('value');
});
