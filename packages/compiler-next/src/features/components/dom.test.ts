/** Native observations complement the independently rerendering reference. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findAll } from 'yuku-ast';
import { parse } from 'yuku-parser';
import { getExtensionStore, registeredIds, setScheduler, unregisterSubtree } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

let sequence = 0;
const mounted: HTMLElement[] = [];

const failedMounts = [
  {
    name: 'root setup',
    setup: 'const value = fail();',
    markup: '<Child value={value} />',
  },
  {
    name: 'a later sibling expression',
    setup: '',
    markup: '<Child value="first" /><i title={fail()} />',
  },
  {
    name: 'a nested child setup',
    setup: '',
    markup: '<Child value="first" /><Broken />',
  },
];

it.each(failedMounts)('releases every setup resource after failure in $name and permits a retry', async ({ setup, markup }) => {
  const { root, module } = await compile(`
    import { mount } from '@memoized-dom/runtime/testing';
    let permitted = false;
    function fail() {
      if (!permitted) throw new Error('setup failure');
      return 'ready';
    }
    function Child({ value }) { return <p>{value}</p>; }
    function Broken() { const value = fail(); return <p>{value}</p>; }
    export function App() { ${setup} return <main>${markup}</main>; }
    export function start(host) { return mount(host, App); }
    export function allow() { permitted = true; }
  `, false);
  const computations = getExtensionStore('mmd:owned-computations', () => new Map());
  const before = computations.size;
  expect(() => module.start(root)).toThrow('setup failure');
  expect(root.childNodes).toHaveLength(0);
  expect(registeredIds()).toEqual([]);
  expect(computations.size).toBe(before);
  await Promise.resolve();
  module.allow();
  const application = module.start(root);
  expect(root.querySelector('p')).not.toBeNull();
  application.unmount();
  expect(registeredIds()).toEqual([]);
  expect(computations.size).toBe(before);
});

it('disposes a failed child mount while its existing parent remains mounted', async () => {
  const { root, module } = await compile(`
    import { flushWritesBeforeAwait } from '@memoized-dom/runtime/testing';
    let allowed = false;
    export let select;
    function Child({ value }) {
      if (!allowed) throw new Error('child failure');
      return <output>{value}</output>;
    }
    export function App() {
      let shown = false;
      select = value => { shown = value; };
      return <main>{shown && <Child value="ready" />}</main>;
    }
    export function change(value) { select(value); flushWritesBeforeAwait(undefined); }
    export function allow() { allowed = true; }
  `);
  const before = registeredIds();
  expect(() => module.change(true)).toThrow('child failure');
  expect(registeredIds()).toEqual(before);
  expect(root.querySelector('output')).toBeNull();
  module.allow();
  module.change(false);
  module.change(true);
  expect(root.querySelector('output')?.textContent).toBe('ready');
});

it('forwards changed symbol props and preserves rest-property order', async () => {
  const { root, click } = await compile(`
    const token = Symbol('token');
    function Child({ [token]: value, ...rest }) {
      return <p>{value}:{Object.keys(rest).join(',')}</p>;
    }
    export function App() {
      let value = 1; let reversed = false;
      const props = reversed ? { b: 2, a: 1, [token]: value } : { a: 1, b: 2, [token]: value };
      return <main><Child {...props} />
        <button id="value" onClick={() => value++}>value</button>
        <button id="order" onClick={() => { reversed = true; }}>order</button></main>;
    }
  `);
  expect(root.querySelector('p')?.textContent).toBe('1:a,b');
  click('#value');
  expect(root.querySelector('p')?.textContent).toBe('2:a,b');
  click('#order');
  expect(root.querySelector('p')?.textContent).toBe('2:b,a');
});

it('inherits the consuming namespace for custom tags and stored markup', async () => {
  const { root } = await compile(`
    function Custom() { return <custom-shape data-kind="component" />; }
    export function App() {
      const shape = <custom-shape data-kind="stored" />;
      return <main><svg><Custom />{shape}</svg><section>{shape}</section></main>;
    }
  `);
  const nodes = [...root.querySelectorAll('custom-shape')];
  expect(nodes.map((node) => node.namespaceURI)).toEqual([
    'http://www.w3.org/2000/svg',
    'http://www.w3.org/2000/svg',
    'http://www.w3.org/1999/xhtml',
  ]);
});

it.each(['module', 'parent'])('settles earlier %s reads after a child writes during mount', async (owner) => {
  const state = 'let count = 0;';
  const child = 'function Child() { count++; return <i>child</i>; }';
  const outside = owner === 'module' ? `${state} ${child}` : '';
  const inside = owner === 'parent' ? `${state} ${child}` : '';
  const { root } = await compile(`
    ${outside}
    export function App() {
      ${inside}
      return <main><p>{count}</p><Child /></main>;
    }
  `);
  expect(root.querySelector('p')?.textContent).toBe('1');
});

afterEach(() => {
  clearCompiledApps();
  for (const root of mounted.splice(0)) {
    root.remove();
  }
});

async function compile(source: string, mountRoot = true) {
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
  if (mountRoot) {
    root.append(module.App('components', null));
  }
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

it('registers a root factory for an authored mount entry and removes it cleanly', async () => {
  const { root, module } = await compile(`
    import { mount } from '@memoized-dom/runtime/testing';
    function Child({ value }) { return <p>{value}</p>; }
    export function App() {
      let count = 0;
      return <main><Child value={count} /><button onClick={() => count++}>inc</button></main>;
    }
    export function start(host) { return mount(host, App); }
  `, false);
  const app = module.start(root);
  expect(root.querySelector('p')?.textContent).toBe('0');
  root.querySelector<HTMLButtonElement>('button')!.click();
  expect(root.querySelector('p')?.textContent).toBe('1');
  app.unmount();
  expect(root.childNodes).toHaveLength(0);
  expect(registeredIds()).toEqual([]);
});
