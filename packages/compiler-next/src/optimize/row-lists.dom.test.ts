/** Row lists show what the general path shows, with the same row DOM identity. */
import { afterEach, expect, it, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setScheduler } from '@memoized-dom/runtime/testing';
import * as runtime from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../tests/harness/compilers';
import { compileModules } from '../pipeline';

const hosts: HTMLElement[] = [];
let sequence = 0;
let rowSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  rowSpy?.mockRestore();
  rowSpy = undefined;
  clearCompiledApps();
  for (const host of hosts.splice(0)) host.remove();
});

function compile(source: string, optimize: boolean): string {
  return compileModules({ './App.tsx': source }, { runtimePath: '@memoized-dom/runtime/testing', optimize })['./App.tsx']!;
}

async function mount(source: string, optimize: boolean) {
  const directory = join(import.meta.dirname, '../../tests/out/row-lists');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}-${optimize ? 'optimized' : 'general'}.js`);
  writeFileSync(file, compile(source, optimize));
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  host.append(module.App('row-lists', null));
  const click = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!.click();
  return { host, click, module };
}

/** Each step's rows as `node:text`, where node numbers the DOM elements in order of first appearance. */
async function trace(source: string, optimize: boolean, steps: number) {
  const { host, click } = await mount(source, optimize);
  const ids = new WeakMap<Element, number>();
  let next = 0;
  const shown = () => [...host.querySelectorAll('li')].map((row) => {
    if (!ids.has(row)) ids.set(row, ++next);
    return `${ids.get(row)}:${row.textContent}`;
  }).join(' ');
  const result = [shown()];
  for (let step = 0; step < steps; step++) {
    click('next');
    result.push(shown());
  }
  return result;
}

function watchRowUpdates(): number[] {
  const updated: number[] = [];
  const create = runtime.createRowList;
  rowSpy = spyOn(runtime, 'createRowList').mockImplementation((anchor, owner, key, factory, path) =>
    create(anchor, owner, key, (item, index) => {
      const entry = factory(item, index);
      const update = entry.update;
      entry.update = (item, index) => { updated.push((item as { id: number }).id); update(item, index); };
      return entry;
    }, path));
  return updated;
}

it.each(['local inline', 'shared inline', 'local component', 'shared component'])(
  'updates only the old and new selected row: %s', async (kind) => {
    const updated = watchRowUpdates();
    const shared = kind.startsWith('shared');
    const component = kind.endsWith('component');
    const state = 'let selected = 0;';
    const row = component
      ? shared ? '<Item key={row.id} row={row} />' : '<Item key={row.id} row={row} on={selected === row.id} />'
      : '<li key={row.id} class={selected === row.id ? "on" : ""}>{index}:{row.id}</li>';
    const source = `
      ${shared ? state : ''}
      ${component ? `function Item(props) { return <li class={${shared ? 'selected === props.row.id' : 'props.on'} ? 'on' : ''}>{props.row.id}</li>; }` : ''}
      export function App() {
        ${shared ? '' : state}
        let rows = Array.from({ length: 1000 }, (_, index) => ({ id: index + 1 }));
        return <main><ul>{rows.map((row, index) => ${row})}</ul>
          <button id="one" onClick={() => { selected = 1; }}>1</button>
          <button id="last" onClick={() => { selected = 1000; }}>last</button>
          <button id="reverse" onClick={() => { rows = rows.toReversed(); }}>reverse</button></main>;
      }`;
    expect(compile(source, true)).toContain('.route(');
    const { host, click } = await mount(source, true);
    const first = host.querySelector('li');
    click('one');
    expect(updated).toEqual([1]);
    updated.length = 0;
    click('last');
    expect(updated).toEqual([1, 1000]);
    expect(host.querySelectorAll('.on')).toHaveLength(1);
    updated.length = 0;
    click('last');
    expect(updated).toEqual([]);
    click('reverse');
    updated.length = 0;
    click('one');
    expect(updated).toEqual([1000, 1]);
    expect(host.querySelector('li:last-child')).toBe(first);
    expect(first?.className).toBe('on');
  },
);

it('merges multiple selection routes and updates their union once in row order', async () => {
  const updated = watchRowUpdates();
  const { host, click } = await mount(`
    export function App() {
      let selected = 0, hovered = 0;
      let rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
      return <main><ul>{rows.map((row) => <li key={row.id} class={selected === row.id || hovered === row.id ? 'on' : ''}>{row.id}</li>)}</ul>
        <button id="first" onClick={() => { selected = 1; hovered = 2; }}>first</button>
        <button id="next" onClick={() => { selected = 2; hovered = 3; }}>next</button></main>;
    }`, true);
  click('first');
  expect(updated).toEqual([1, 2]);
  updated.length = 0;
  click('next');
  expect(updated).toEqual([1, 2, 3]);
  expect([...host.querySelectorAll('li')].map((row) => row.className)).toEqual(['', 'on', 'on', '']);
});

it.each([true, false])('refreshes the full site when the selection also has a plain read (optimize: %p)', async (optimize) => {
  const { host, click } = await mount(`
    export function App() {
      let selected = 0;
      let rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
      return <main><ul>{rows.map((row) => <li key={row.id} title={selected} class={selected === row.id ? 'on' : ''}>{row.id}</li>)}</ul>
        <button id="one" onClick={() => { selected = 1; }}>1</button></main>;
    }`, optimize);
  click('one');
  expect([...host.querySelectorAll('li')].map((row) => `${row.className}/${row.title}`)).toEqual(['on/1', '/1', '/1']);
});

it.each([true, false])('disposes hidden routes and restores the current selection on remount (optimize: %p)', async (optimize) => {
  const { host, click } = await mount(`
    let selected = 0;
    export function App() {
      let show = true;
      let rows = [{ id: 1 }, { id: 2 }];
      return <main>{show ? <ul>{rows.map((row) => <li key={row.id} class={selected === row.id ? 'on' : ''}>{row.id}</li>)}</ul> : <p>hidden</p>}
        <button id="one" onClick={() => { selected = 1; }}>1</button>
        <button id="two" onClick={() => { selected = 2; }}>2</button>
        <button id="toggle" onClick={() => { show = !show; }}>toggle</button></main>;
    }`, optimize);
  click('one');
  click('toggle');
  click('two');
  expect(host.querySelector('ul')).toBeNull();
  click('toggle');
  expect([...host.querySelectorAll('li')].map((row) => row.className)).toEqual(['', 'on']);
});

it.each([true, false])('collects a shared read first reached by a selection (optimize: %p)', async (optimize) => {
  const { host, click } = await mount(`
    let selected = 0;
    let theme = 'red';
    export function App() {
      let rows = [{ id: 1 }, { id: 2 }];
      return <main><ul>{rows.map((row) => <li key={row.id}
        class={selected === row.id ? theme : 'off'} title={selected !== row.id ? 'no' : 'yes'}>{row.id}</li>)}</ul>
        <button id="one" onClick={() => { selected = 1; }}>1</button>
        <button id="theme" onClick={() => { theme = 'blue'; }}>theme</button></main>;
    }`, optimize);
  click('one');
  expect([...host.querySelectorAll('li')].map((row) => row.className)).toEqual(['red', 'off']);
  click('theme');
  expect([...host.querySelectorAll('li')].map((row) => `${row.className}/${row.title}`)).toEqual(['blue/yes', 'off/no']);
});

it.each([true, false])('retains selection dependencies through a custom map and back (optimize: %p)', async (optimize) => {
  const { host, click } = await mount(`
    let selected = 0;
    const other = { map(callback) { return [callback({ id: 1 }), callback({ id: 2 })]; } };
    export function App() {
      let custom = false;
      let rows = [{ id: 1 }, { id: 2 }];
      return <main><ul>{(custom ? other : rows).map((row) => <li key={row.id} class={selected === row.id ? 'on' : ''}>{row.id}</li>)}</ul>
        <button id="one" onClick={() => { selected = 1; }}>1</button>
        <button id="two" onClick={() => { selected = 2; }}>2</button>
        <button id="toggle" onClick={() => { custom = !custom; }}>toggle</button></main>;
    }`, optimize);
  click('one');
  click('toggle');
  click('two');
  expect([...host.querySelectorAll('li')].map((row) => row.className)).toEqual(['', 'on']);
  click('toggle');
  click('one');
  expect([...host.querySelectorAll('li')].map((row) => row.className)).toEqual(['on', '']);
});

it.each([true, false])('specializes a shared leaf factory only for lists whose key matches (optimize: %p)', async (optimize) => {
  const { host, click } = await mount(`
    let selected = 0;
    function Item(props) { return <li class={selected === props.row.id ? 'on' : ''}>{props.row.id}</li>; }
    export function App() {
      let rows = [{ id: 1, other: 11 }, { id: 2, other: 12 }];
      return <main><ul>{rows.map((row) => <Item key={row.id} row={row} />)}</ul>
        <ol>{rows.map((row) => <Item key={row.other} row={row} />)}</ol>
        <button id="one" onClick={() => { selected = 1; }}>1</button>
        <button id="two" onClick={() => { selected = 2; }}>2</button></main>;
    }`, optimize);
  click('one');
  expect([...host.querySelectorAll('li')].map((row) => row.className)).toEqual(['on', '', 'on', '']);
  click('two');
  expect([...host.querySelectorAll('li')].map((row) => row.className)).toEqual(['', 'on', '', 'on']);
});

const steps = `
  let rows = [{ id: 1, l: 'a' }, { id: 2, l: 'b' }, { id: 3, l: 'c' }];
  const changes = [
    () => { rows = [rows[2], rows[0], rows[1]]; },
    () => { rows = [rows[0], rows[0], rows[1]]; },
    () => { rows = [{ id: 1, l: 'x' }, ...rows]; },
    () => { const holes = []; holes[2] = { id: 9, l: 'h' }; holes[0] = { id: 8, l: 'g' }; rows = holes; },
    () => { rows = [{ id: '1', l: 's' }, { id: 1, l: 'n' }, { id: null, l: 'z' }]; },
    () => { rows.reverse(); },
    () => { rows.splice(1, 1); },
    () => { rows[0].l = 'edited'; },
    () => { rows = []; },
    () => { rows = [{ id: 5, l: 'e' }]; },
  ];
  let step = 0;
`;

it.each(['<li key={row.id}>{row.l}</li>', '<li>{row.l}</li>', '<li key={row.id}>{index}{row.l}</li>'])(
  'keeps the general path\'s row identity through moves, duplicates, holes and edits: %s',
  async (row) => {
    const source = `${steps}
      export function App() {
        return <main><ul>{rows.map((row, index) => ${row})}</ul>
          <button id="next" onClick={() => { changes[step++](); }}>next</button></main>;
      }`;
    expect(compile(source, true)).toContain('createRowList(');
    const optimized = await trace(source, true, 10);
    const general = await trace(source, false, 10);
    expect(optimized).toEqual(general);
  },
);

it.each([true, false])('runs a row handler with the item its row shows now (optimize: %p)', async (optimize) => {
  const { host, click } = await mount(`
    let rows = [{ id: 1, l: 'a' }, { id: 2, l: 'b' }];
    let picked = '';
    export function App() {
      return <main><p>{picked}</p><ul>{rows.map((row, index) =>
        <li key={row.id} onClick={() => { picked = row.l + index; }}>{row.l}</li>)}</ul>
        <button id="swap" onClick={() => { rows = [{ id: 2, l: 'B' }, { id: 1, l: 'A' }]; }}>swap</button></main>;
    }
  `, optimize);
  const first = () => host.querySelector('li')!;
  first().click();
  expect(host.querySelector('p')!.textContent).toBe('a0');
  click('swap');
  first().click();
  expect(host.querySelector('p')!.textContent).toBe('B0');
  host.querySelectorAll('li')[1]!.click();
  expect(host.querySelector('p')!.textContent).toBe('A1');
});

it.each([true, false])('shows a receiver whose map is not the intrinsic through the authored callback (optimize: %p)', async (optimize) => {
  const { host, click } = await mount(`
    let rows = [{ id: 1 }];
    let custom = false;
    const other = { map(callback) { return [callback({ id: 7 }), callback({ id: 8 })]; } };
    export function App() {
      return <main><ul>{(custom ? other : rows).map((row) => <li key={row.id}>{row.id}</li>)}</ul>
        <button id="toggle" onClick={() => { custom = !custom; }}>toggle</button></main>;
    }
  `, optimize);
  const text = () => host.querySelector('ul')!.textContent;
  expect(text()).toBe('1');
  click('toggle');
  expect(text()).toBe('78');
  click('toggle');
  expect(text()).toBe('1');
});

it.each([true, false])('shows stored JSX and arrays inside rows and removes them with the row (optimize: %p)', async (optimize) => {
  const { host, click } = await mount(`
    let rows = [{ id: 1, extra: <b>bold</b> }, { id: 2, extra: ['x', <i>y</i>] }, { id: 3, extra: 'plain' }];
    export function App() {
      return <main><ul>{rows.map((row) => <li key={row.id}>{row.extra}</li>)}</ul>
        <button id="drop" onClick={() => { rows = rows.slice(2); }}>drop</button></main>;
    }
  `, optimize);
  const html = () => host.querySelector('ul')!.innerHTML.replace(/<!--[^>]*-->/g, '');
  expect(html()).toBe('<li><b>bold</b></li><li>x<i>y</i></li><li>plain</li>');
  click('drop');
  expect(html()).toBe('<li>plain</li>');
});

it.each([true, false])('creates rows in the namespace where the list is shown (optimize: %p)', async (optimize) => {
  const { host } = await mount(`
    const circles = [{ id: 1, r: 2 }, { id: 2, r: 3 }];
    let shown = circles;
    export function App() {
      return <main><svg>{shown.map((circle) => <circle key={circle.id} r={circle.r} />)}</svg>
        <button onClick={() => { shown = []; }}>clear</button></main>;
    }
  `, optimize);
  const circles = [...host.querySelectorAll('circle')];
  expect(circles.map((circle) => circle.namespaceURI)).toEqual(['http://www.w3.org/2000/svg', 'http://www.w3.org/2000/svg']);
  expect(circles.map((circle) => circle.getAttribute('r'))).toEqual(['2', '3']);
});

it('keeps the general path when the key is not the first attribute or the row is not one element', () => {
  const source = (row: string) => `
    let rows = [{ id: 1 }];
    export function App() {
      return <main><ul>{rows.map((row) => ${row})}</ul><button onClick={() => { rows = []; }}>clear</button></main>;
    }`;
  expect(compile(source('<li title={row.id} key={row.id}>{row.id}</li>'), true)).not.toContain('createRowList(');
  expect(compile(source('<><li>{row.id}</li></>'), true)).not.toContain('createRowList(');
  expect(compile(source('<li key={row.id}>{row.id}</li>'), true)).toContain('createRowList(');
  expect(compile(source('<li key={row.id}>{row.id}</li>'), false)).not.toContain('createRowList(');
});

it.each(['<Item key={row.id} row={row} index={index} />', '<Item row={row} index={index} />'])(
  'keeps the general path\'s identity for leaf component rows: %s',
  async (row) => {
    const source = `${steps}
      let selected = 1;
      function Item(props) {
        return <li class={selected === props.row.id ? 'on' : ''}>{props.index}{props.row.l}</li>;
      }
      export function App() {
        return <main><ul>{rows.map((row, index) => ${row})}</ul>
          <button id="next" onClick={() => { changes[step++](); selected = 5; }}>next</button></main>;
      }`;
    expect(compile(source, true)).toContain('function _Item_row(');
    const optimized = await trace(source, true, 10);
    const general = await trace(source, false, 10);
    expect(optimized).toEqual(general);
  },
);

it.each([true, false])('passes the same props object to a method a component row calls (optimize: %p)', async (optimize) => {
  const { host, click } = await mount(`
    let rows = [{ id: 1 }, { id: 2 }];
    let seen = [];
    let shown = '';
    function select(id) { seen.push(this); shown = id + ':' + new Set(seen).size; }
    function Item(props) {
      return <li class={props.on ? 'on' : ''} onClick={() => { props.select(props.row.id); }}>{props.row.id}</li>;
    }
    export function App() {
      let tick = 0;
      return <main><p>{shown}</p><ul>{rows.map((row) => <Item key={row.id} row={row} on={tick > 1} select={select} />)}</ul>
        <button id="tick" onClick={() => { tick++; }}>tick</button></main>;
    }
  `, optimize);
  const first = () => host.querySelector('li')!;
  first().click();
  click('tick');
  first().click();
  // Props with the same fields keep the first object, as the general receiver does.
  expect(host.querySelector('p')!.textContent).toBe('1:1');
  click('tick');
  first().click();
  expect(host.querySelector('p')!.textContent).toBe('1:2');
  expect(first().className).toBe('on');
});

it.each([true, false])('shows edits a component row\'s handler makes through its props (optimize: %p)', async (optimize) => {
  const source = `
    let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
    let marked = 0;
    function mark(id) { this.row.label += '?'; marked = id; }
    function Item(props) {
      return <li onClick={() => { props.row.label += '!'; props.mark(props.row.id); }}>{props.row.label}</li>;
    }
    export function App() {
      return <main><p>{marked}</p><ul>{rows.map((row) => <Item key={row.id} row={row} mark={mark} />)}</ul></main>;
    }`;
  expect(compile(source, true)).toContain('_Item_row(');
  const { host } = await mount(source, optimize);
  host.querySelectorAll('li')[1]!.click();
  expect(host.querySelector('p')!.textContent).toBe('2');
  expect(host.querySelector('ul')!.textContent).toBe('ab!?');
  host.querySelectorAll('li')[0]!.click();
  expect(host.querySelector('ul')!.textContent).toBe('a!?b!?');
});

it('compiles only leaf components as rows', () => {
  const source = (item: string) => `
    let rows = [{ id: 1 }];
    ${item}
    export function App() {
      return <main><ul>{rows.map((row) => <Item key={row.id} row={row} />)}</ul><button onClick={() => { rows = []; }}>clear</button></main>;
    }`;
  expect(compile(source('function Item(props) { return <li>{props.row.id}</li>; }'), true)).toContain('_Item_row(');
  expect(compile(source('function Item(props) { let n = 0; return <li onClick={() => n++}>{n}</li>; }'), true)).not.toContain('_Item_row(');
  expect(compile(source('function Item(props) { const label = props.row.id + 1; return <li>{label}</li>; }'), true)).not.toContain('_Item_row(');
  expect(compile(source('function Item({ row }) { return <li>{row.id}</li>; }'), true)).not.toContain('_Item_row(');
  // A fragment of one element mounts that element; two roots are not one row node.
  expect(compile(source('function Item(props) { return <><li>{props.row.id}</li></>; }'), true)).toContain('_Item_row(');
  expect(compile(source('function Item(props) { return <><li>{props.row.id}</li><li /></>; }'), true)).not.toContain('_Item_row(');
  expect(compile(source('function Item(props) { return <li>{props.row.id}</li>; } Item = () => null;'), true)).not.toContain('_Item_row(');
  // Edits of its props while it renders, rather than in a handler, keep the component.
  expect(compile(source('function Item(props) { return <li>{props.row.list.pop()}</li>; }'), true)).not.toContain('_Item_row(');
  expect(compile(source('function Item(props) { return <li onClick={() => { props.row.id++; }}>{props.row.id}</li>; }'), true)).toContain('_Item_row(');
});
