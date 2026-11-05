/** Lowered member calls keep native order and every edit the general path shows. */
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
  const directory = join(import.meta.dirname, '../../tests/out/method-calls');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}-${optimize ? 'optimized' : 'general'}.js`);
  writeFileSync(file, compile(source, optimize));
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  host.append(module.App('method-calls', null));
  const click = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!.click();
  return { host, click, module };
}

const modes = [
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
];

it('decides from the name at compile time, with no runtime check of the callee', () => {
  const observed = (call: string) => compile(`
    import { imported } from './library';
    let total = 0;
    function fmt(value) { return value + 1; }
    function touch(value) { value.seen = true; return value; }
    export function App() {
      let items = [{ n: 1 }];
      return <p onClick={() => { ${call}; }}>{items.length}</p>;
    }
  `, true).includes('observeMutation(');

  // Reading methods stay plain calls, with a callback that reads, calls a host
  // function, uses a known method, or calls the program's own pure function.
  expect(observed('items.slice(1)')).toBe(false);
  expect(observed('items.map((item) => item.n * 2)')).toBe(false);
  expect(observed('items.map((item) => String(item.n))')).toBe(false);
  expect(observed('items.filter((item) => { let seen = item.n; seen++; return seen > 1; })')).toBe(false);
  expect(observed('items.filter((item) => `${item.n}`.includes("1"))')).toBe(false);
  expect(observed('items.map((item) => fmt(item.n))')).toBe(false);
  // Writing a plain name edits no object, and that write reports itself.
  expect(observed('items.map((item) => { total += item.n; return item; })')).toBe(false);

  // A callback that can edit what it receives keeps the general observation.
  expect(observed('items.map((item) => { item.n++; return item; })')).toBe(true);
  expect(observed('items.map((item) => touch(item))')).toBe(true);
  expect(observed('items.map(touch)')).toBe(true);

  // A known method only reads its arguments, whatever its receiver.
  expect(observed('[1].concat(items)')).toBe(false);
  expect(observed('make().concat(items)')).toBe(false);
  expect(observed('const out = []; out.push(items)')).toBe(false);

  // A host function does not edit what it is given.
  expect(observed('clearInterval(items)')).toBe(false);
  expect(observed('console.log(items)')).toBe(false);
  expect(observed('JSON.stringify(items)')).toBe(false);
  expect(observed('setTimeout(() => { items.length = 0; }, 0)')).toBe(false);
  // A library or an unknown global might, and so might a host function's name rebound here.
  expect(observed('unknownGlobal(items)')).toBe(true);
  expect(observed('Object.assign(items, {})')).toBe(true);
  expect(observed('const clearInterval = touch; clearInterval(items)')).toBe(true);

  // An unknown method, and a known name on an object from elsewhere.
  expect(observed('items.unfamiliar()')).toBe(true);
  expect(observed('other.map(items)')).toBe(true);
  expect(observed('imported.fill(items, 0)')).toBe(true);

  const output = compile(`
    export function App() {
      let items = [1];
      return <p onClick={() => { items.slice(1); items.push(2); }}>{items.length}</p>;
    }
  `, true);
  expect(output).toContain('.slice(1)');
  expect(output).toMatch(/\.editArray\([^;]*, "push", \[2\], /);
  for (const check of ['Array.prototype', 'getOwnPropertyDescriptor', 'observeMethod']) {
    expect(output).not.toContain(check);
  }
});

it('trusts no name the module itself gives another meaning', () => {
  const observed = (setup: string) => compile(`
    ${setup}
    export function App() {
      let items = [1];
      return <p onClick={() => { items.slice(1); }}>{items.length}</p>;
    }
  `, true).includes('observeMutation(');

  expect(observed('')).toBe(false);
  expect(observed('class Rows { slice() {} }')).toBe(true);
  expect(observed('const rows = { slice() {} };')).toBe(true);
  expect(observed('const rows = { slice: () => {} };')).toBe(true);
  expect(observed('const rows = {}; rows.slice = run;')).toBe(true);
  expect(observed("Object.defineProperty(target, 'slice', { value() {} });")).toBe(true);
  // A data field of the same name defines no method.
  expect(observed("const query = { slice: 'all' };")).toBe(false);
});

it('leaves the general path observing every call', () => {
  const output = compile('export function App() { let a = [1]; return <p onClick={() => { a = a.slice(1); }}>{a.length}</p>; }', false);
  expect(output).toContain('observeMutation(');
  expect(output).not.toContain('editArray');
});

it.each(modes)('updates for native array calls on state, read-only and editing ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    export function App() {
      let items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      return <main>
        <ul>{items.map((item) => <li key={item.id}>{item.id}</li>)}</ul>
        <button id="drop" onClick={() => { items = items.slice(1); }}>drop</button>
        <button id="reverse" onClick={() => { items.reverse(); }}>reverse</button>
        <button id="push" onClick={() => { items.push({ id: 9 }); }}>push</button>
        <button id="sort" onClick={() => { items.sort((a, b) => a.id - b.id); }}>sort</button>
      </main>;
    }
  `, optimize);
  const text = () => host.querySelector('ul')!.textContent;
  expect(text()).toBe('123');
  click('reverse');
  expect(text()).toBe('321');
  click('push');
  expect(text()).toBe('3219');
  click('sort');
  expect(text()).toBe('1239');
  click('drop');
  expect(text()).toBe('239');
});

it.each(modes)('shows edits by an overridden method and by an effectful callback ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    export function App() {
      let items = [{ n: 1 }, { n: 2 }];
      const special = [{ n: 5 }];
      special.slice = function () { this[0].n++; return []; };
      return <main>
        <p>{items.map((item) => item.n).join(',')}|{special[0].n}</p>
        <button id="bump" onClick={() => { items.map((item) => { item.n *= 10; return item; }); }}>bump</button>
        <button id="special" onClick={() => { special.slice(); }}>special</button>
      </main>;
    }
  `, optimize);
  const text = () => host.querySelector('p')!.textContent;
  expect(text()).toBe('1,2|5');
  click('bump');
  expect(text()).toBe('10,20|5');
  click('special');
  expect(text()).toBe('10,20|6');
});

it.each(modes)('evaluates receiver, method, arguments and call in native order ($mode)', async ({ optimize }) => {
  const { module, click } = await mount(`
    export const log = [];
    export function App() {
      let items = [1, 2, 3];
      const holder = { get list() { log.push('receiver'); return items; } };
      const at = (value) => { log.push('argument'); return value; };
      return <main>
        <p>{items.length}</p>
        <button id="go" onClick={() => { items = holder.list.slice(at(1)); log.push('done'); }}>go</button>
      </main>;
    }
  `, optimize);
  click('go');
  expect(module.log).toEqual(['receiver', 'argument', 'done']);
});

/** The optimized output for a handler that makes `call` on a list of records. */
function handlerCalling(call: string): string {
  return compile(`
    export function App() {
      let rows = [{ n: 1 }];
      let total = 0;
      let last = null;
      return <main>
        <button onClick={() => { ${call} }}>go</button>
        <p>{rows[0].n}:{total}</p>
      </main>;
    }
  `, true);
}

it('observes no call whose callback only writes plain names', () => {
  expect(handlerCalling('rows.forEach((row) => { total += row.n; });')).not.toContain('observeMutation');
  expect(handlerCalling('rows.forEach((row) => { last = row; });')).not.toContain('observeMutation');
});

it('observes no direct call of a function that only writes plain names', () => {
  const program = (setup: string, call: string) => compile(`
    export function App() {
      let rows = [{ n: 1 }];
      let total = 0;
      ${setup}
      return <main><button onClick={() => { ${call} }}>go</button><p>{rows[0].n}:{total}</p></main>;
    }
  `, true);
  expect(program('const pick = (n) => { total = n; };', 'pick(rows[0].n);')).not.toContain('observeMutation');
  expect(program('const edit = (row) => { row.n = 2; };', 'edit(rows[0]);')).toContain('observeMutation');
  expect(program('let pick = (n) => { total = n; }; pick = window.other;', 'pick(rows[0]);')).toContain('observeMutation');
});

it('observes a call whose callback edits an object, or whose callback it cannot see', () => {
  expect(handlerCalling('rows.forEach((row) => { total += 1; row.n = 2; });')).toContain('observeMutation');
  expect(handlerCalling('rows.forEach((row) => { last = row; last.n = 2; });')).toContain('observeMutation');
  expect(handlerCalling('rows.forEach((row) => { [row.n] = [2]; });')).toContain('observeMutation');
  expect(handlerCalling('rows.forEach(window.visit);')).toContain('observeMutation');
});

it.each(modes)('keeps a getter-returned object reactive after reverse stores it as data ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    const added = { id: 10 };
    const items = [{ id: 0 }, { id: 1 }];
    const prime = { count: 0 };
    Object.defineProperty(items, 0, {
      get: () => added,
      set() {},
      configurable: true,
    });
    export function App() {
      return <main><p>{items[1].id}</p>
        <button id="reverse" onClick={() => { prime.count++; items.reverse(); }}>reverse</button>
        <button id="edit" onClick={() => { added.id++; }}>edit</button>
      </main>;
    }
  `, optimize);
  expect(host.querySelector('p')!.textContent).toBe('1');
  click('reverse');
  expect(host.querySelector('p')!.textContent).toBe('10');
  click('edit');
  expect(host.querySelector('p')!.textContent).toBe('11');
});
