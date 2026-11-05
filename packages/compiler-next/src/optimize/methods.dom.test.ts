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

// The reference renderer cannot run this one: it reads `n` for the call's inputs outside
// the authored `try`, so its dead zone throws out of the render.
it.each(modes)('throws for a write before the declaration, with several writes sharing a store ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    const seen = { name: '' };
    export function App() {
      const early = () => { try { n = 5; } catch (error) { seen.name = error.name; } };
      early();
      let n = 1;
      return <main>
        <button id="a" onClick={() => { n = 2; }}>a</button>
        <button id="b" onClick={() => { n = 3; }}>b</button>
        <p>{seen.name}:{n}</p>
      </main>;
    }
  `, optimize);
  const text = () => host.querySelector('p')!.textContent;
  expect(text()).toBe('ReferenceError:1');
  click('a');
  expect(text()).toBe('ReferenceError:2');
  click('b');
  expect(text()).toBe('ReferenceError:3');
});

it('keeps a large site expression holding an await where it was written', () => {
  const big = 'n, n + 1, n + 2, n + 3, n + 4, n + 5, n + 6';
  const program = (first: string, asynchronous: string) => compile(`
    export ${asynchronous} function App() {
      let n = 1;
      return <main><button onClick={() => { n++; }}>go</button><p>{[${first}${big}].join('')}</p></main>;
    }
  `, true);
  expect(program('', '')).toContain('_evaluate');
  expect(program('await Promise.resolve(n), ', 'async')).not.toContain('_evaluate');
});

it('observes a call on a ref unless the ref can only hold a node', () => {
  const observed = (setup: string, attribute: string, tag = 'input') => compile(`
    ${tag === 'Comp' ? 'function Comp(props) { props.ref({ focus() {} }); return <i />; }' : ''}
    export function App() {
      ${setup}
      return <main><${tag} ${attribute} /><button onClick={() => { el?.focus(); }}>go</button></main>;
    }
  `, true).includes('observeMutation(');

  expect(observed('let el;', 'ref={el}')).toBe(false);
  expect(observed('let el = null;', 'ref={el}')).toBe(false);
  expect(observed('let el = undefined;', 'ref={el}')).toBe(false);

  // These can hold something other than a node.
  expect(observed('let el = { focus() {} };', 'ref={el}')).toBe(true);
  expect(observed('let el; el = { focus() {} };', 'ref={el}')).toBe(true);
  expect(observed('let el; const set = () => { el = { focus() {} }; };', 'ref={el}')).toBe(true);
  expect(observed('let el; let other;', 'ref={[el, other]}')).toBe(true);
  expect(observed('let el;', 'ref={el}', 'Comp')).toBe(true);
});

it('observes nothing for a method of a tracked handle, but does for its payload', () => {
  const observed = (imported: string, tracked: string, call: string) => compile(`
    ${imported}
    export function App() {
      const items = $fetch('/items');
      const handle = ${tracked};
      return <main><button onClick={() => { ${call} }}>go</button><p>{handle.refreshing ? 'y' : 'n'}</p></main>;
    }
  `, true).includes('observeMutation(');

  const data = "import { $fetch, $track } from '@memoized-dom/data';";
  expect(observed(data, '$track(items)', 'handle.refresh();')).toBe(false);
  expect(observed("import { $fetch, $track as watch } from '@memoized-dom/data';", 'watch(items)', 'handle.refresh();')).toBe(false);

  // A known edit of the payload reports itself; an unknown method of it is observed.
  expect(compile(`
    ${data}
    export function App() {
      const items = $fetch('/items');
      const handle = $track(items);
      return <main><button onClick={() => { handle.data.push(1); }}>go</button><p>{handle.refreshing ? 'y' : 'n'}</p></main>;
    }
  `, true)).toContain('editArray(');
  expect(observed(data, '$track(items)', 'handle.data.touch();')).toBe(true);
  expect(observed(data, '$track(items)', 'handle.refresh(items);')).toBe(true);
  // A function of the program with that name is not the framework's.
  expect(observed("import { $fetch } from '@memoized-dom/data'; function $track(value) { return { refresh() { value.n = 1; }, refreshing: false }; }", '$track(items)', 'handle.refresh();')).toBe(true);
});

it('does not watch a step of a derived value that can edit nothing', () => {
  const observed = (body: string) => compile(`
    export function App() {
      let search = 'A';
      let rows = [{ n: 1, title: 'a' }];
      ${body}
      return <main><button onClick={() => { search = 'B'; rows = []; }}>go</button><p>{String(q)}</p></main>;
    }
  `, true).includes('observeMutation(');

  // Reading what it was suspected of building.
  expect(observed("const q = search.toLowerCase(); const shown = rows.filter((row) => row.title.includes(q));")).toBe(false);
  // A timer's callback runs after the step.
  expect(observed('let q = 0; const timer = setInterval(() => { q++; }, 1000);')).toBe(false);
  expect(observed('let q = rows.length; console.log(q);')).toBe(false);

  // These really can build it.
  expect(observed('let q = 0; rows.forEach((row) => { q += row.n; });')).toBe(true);
  expect(observed('let q = 0; Array.from(rows, (row) => { q += row.n; });')).toBe(true);
  expect(observed('let q = { n: 0 }; rows.forEach((row) => { q.n += row.n; });')).toBe(true);
  expect(observed('let q = { n: 0 }; JSON.stringify(rows, (key, value) => { q.n++; return value; });')).toBe(true);
  expect(observed('let q = { n: 0 }; const touch = (value) => { value.n = 1; }; touch(q);')).toBe(true);
  expect(observed('let q = { n: 0 }; unknownGlobal(q);')).toBe(true);
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
