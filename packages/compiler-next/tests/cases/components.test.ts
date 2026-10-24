/**
 * Cases for wiki/compiler/components.md.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

behaves('component values: direct calls and map callbacks keep native arguments', {
  source: `
    function Row(value) { return <li>{value}</li>; }
    export function App() {
      let items = [1, 2];
      const first = Row(items[0]);
      return <main><ol>{first}</ol><ul>{items.map(Row)}</ul>
        <button onClick={() => items.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('ol')?.textContent).toBe('1');
    expect(container.querySelector('ul')?.textContent).toBe(['12', '123'][observation]);
  },
});

behaves('component values: imported direct calls use the defining component', {
  modules: {
    './Row.tsx': `export function Row({ value }) { return <li>{value}</li>; }`,
  },
  source: `
    import { Row } from './Row';
    export function App() {
      let value = 1;
      const view = Row({ value });
      return <main><ul>{view}</ul><button onClick={() => value++}>next</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('li')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('component ownership: nested components read the creating instance', {
  source: `
    export function App() {
      let count = 1;
      function Child() { return <p>{count}</p>; }
      return <main><Child /><button onClick={() => count++}>next</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2', '3'][observation]);
  },
});

behaves('component props: nested defaults rest and aliases update independently', {
  source: `
    function Child({ nested: { value: label = 'default' }, ...rest }) {
      return <p>{label}:{rest.other}</p>;
    }
    export function App() {
      let nested = {}; let other = 0;
      return <main><Child nested={nested} other={other} />
        <button id="value" onClick={() => { nested.value = 'set'; }}>value</button>
        <button id="other" onClick={() => other++}>other</button></main>;
    }`,
  steps: [{ click: '#value' }, { click: '#other' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['default:0', 'set:0', 'set:1'][observation]);
  },
});

behaves('component slots: two consumers own independent state and DOM', {
  source: `
    function Counter({ label }) {
      let count = 0;
      return <button class="child" onClick={() => count++}>{label}:{count}</button>;
    }
    function Frame({ children }) { return <section>{children}</section>; }
    export function App() {
      let label = 'A';
      const content = <Counter label={label} />;
      return <main><Frame>{content}</Frame><Frame>{content}</Frame>
        <button id="label" onClick={() => { label = 'B'; }}>label</button></main>;
    }`,
  steps: [{ click: 'section:first-child .child' }, { click: '#label' }],
  check(container, observation) {
    expect([...container.querySelectorAll('.child')].map((node) => node.textContent))
      .toEqual([['A:0', 'A:0'], ['A:1', 'A:0'], ['B:1', 'B:0']][observation]!);
  },
});

behaves('a member expression as a tag', {
  source: `
    const UI = { Box: ({ children }) => <div class="box">{children}</div> };
    export function App() {
      return <UI.Box>inside</UI.Box>;
    }`,
});

behaves('an extra prop the child does not declare', {
  source: `
    function Child({ a }) {
      return <p>{a}</p>;
    }
    export function App() {
      return <Child a={1} b={2} />;
    }`,
});

behaves('a prop follows the parent', {
  source: `
    function Label({ text }) {
      return <p>{text}</p>;
    }
    export function App() {
      let name = 'a';
      return <main><Label text={name} /><button onClick={() => (name = 'b')}>set</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('complex JSX: render callbacks combine fragments module state and local state', {
  source: `
    let prefix = 'M';
    function Frame({ value, render }) { return <section><header>{prefix}</header>{render(value)}</section>; }
    export function App() {
      let count = 1; let visible = true;
      return <main><Frame value={count} render={value => <><b>{prefix}:{value}</b>{visible && <i>{value * 2}</i>}</>} />
        <button id="count" onClick={() => count++}>count</button><button id="module" onClick={() => { prefix = 'N'; }}>module</button>
        <button id="hide" onClick={() => { visible = false; }}>hide</button></main>;
    }`,
  steps: [{ click: '#count' }, { click: '#module' }, { click: '#hide' }],
  check(container, observation) { expect(container.querySelector('section')?.textContent).toBe(['MM:12', 'MM:24', 'NN:24', 'NN:2'][observation]); },
});

behaves('complex JSX: JSX variables helpers arrays and conditionals stay reactive', {
  source: `
    function label(value) { return <strong>{value}</strong>; }
    export function App() {
      let count = 1; let compact = false;
      const title = <h1>{count}</h1>;
      const rows = [label(count), null, false, <span>{count + 1}</span>];
      return <main><section>{compact ? title : <>{title}{rows}</>}</section>
        <button id="count" onClick={() => count++}>count</button><button id="compact" onClick={() => { compact = true; }}>compact</button></main>;
    }`,
  steps: [{ click: '#count' }, { click: '#compact' }, { click: '#count' }],
  check(container, observation) { expect(container.querySelector('section')?.textContent).toBe(['112', '223', '2', '3'][observation]); },
});

behaves('complex JSX: spread props carry class values and setter callbacks to children', {
  source: `
    class Counter { constructor() { this.raw = 1; } get value() { return this.raw; } set value(next) { this.raw = next; } }
    function Field({ value, change, label }) { return <section><output>{label}:{value}</output><button id="child" onClick={() => change(value + 1)}>edit</button></section>; }
    export function App() {
      const model = new Counter(); let label = 'A';
      const props = { value: model.value, change: next => { model.value = next; }, label };
      return <main><Field {...props} /><button id="label" onClick={() => { label = 'B'; }}>label</button></main>;
    }`,
  steps: [{ click: '#child' }, { click: '#label' }, { click: '#child' }],
  check(container, observation) { expect(container.querySelector('output')?.textContent).toBe(['A:1', 'A:2', 'B:2', 'B:3'][observation]); },
});

behaves('complex JSX: keyed class-backed rows retain local state through reordering and insertion', {
  source: `
    class Counter { constructor(value) { this.value = value; } get label() { return 'v' + this.value; } add() { this.value++; } }
    function Row({ id, start }) {
      const model = new Counter(start); const label = model.label;
      return <li data-id={id}><button id={'edit-' + id} onClick={() => model.add()}>edit</button><span>{label}</span></li>;
    }
    export function App() {
      let rows = [{ id: 'a', start: 1 }, { id: 'b', start: 2 }];
      return <main><ul>{rows.map(row => <Row key={row.id} {...row} />)}</ul>
        <button id="reverse" onClick={() => rows.reverse()}>reverse</button>
        <button id="insert" onClick={() => rows.unshift({ id: 'c', start: 3 })}>insert</button></main>;
    }`,
  steps: [{ click: '#edit-a' }, { click: '#reverse' }, { click: '#insert' }, { click: '#edit-b' }],
  check(container, observation) {
    expect([...container.querySelectorAll('li')].map(node => node.getAttribute('data-id') + ':' + node.querySelector('span')?.textContent))
      .toEqual([['a:v1', 'b:v2'], ['a:v2', 'b:v2'], ['b:v2', 'a:v2'], ['c:v3', 'b:v2', 'a:v2'], ['c:v3', 'b:v3', 'a:v2']][observation]!);
    if (observation === 1) container.querySelector('[data-id="a"]')!.setAttribute('data-retained', 'yes');
    if (observation > 1) expect(container.querySelector('[data-id="a"]')?.getAttribute('data-retained')).toBe('yes');
  },
});

behaves('complex JSX: nested arrays preserve falsy children adjacent numbers and conditional nodes', {
  source: `
    export function App() {
      let count = 0; let show = true;
      const children = [[0, false, null], <>{count}{count + 1}</>, [show && <b>x</b>, undefined, 'end']];
      return <main><section>{children}</section><button id="count" onClick={() => count++}>count</button>
        <button id="hide" onClick={() => { show = false; }}>hide</button></main>;
    }`,
  steps: [{ click: '#count' }, { click: '#hide' }],
  check(container, observation) { expect(container.querySelector('section')?.textContent).toBe(['001xend', '012xend', '012end'][observation]); },
});

behaves('complex JSX: dynamic component tags keep class-derived props current', {
  source: `
    class Counter { constructor() { this.value = 1; } add() { this.value++; } }
    function Strong({ value }) { return <strong>{value}</strong>; }
    function Emphasis({ value }) { return <em>{value}</em>; }
    export function App() {
      const model = new Counter(); let alternate = false;
      const Tag = alternate ? Emphasis : Strong;
      return <main><section><Tag value={model.value} /></section><button id="count" onClick={() => model.add()}>count</button>
        <button id="tag" onClick={() => { alternate = true; }}>tag</button></main>;
    }`,
  steps: [{ click: '#count' }, { click: '#tag' }, { click: '#count' }],
  check(container, observation) {
    const child = container.querySelector('section')?.firstElementChild;
    expect(child?.tagName.toLowerCase()).toBe(['strong', 'strong', 'em', 'em'][observation]);
    expect(child?.textContent).toBe(['1', '2', '2', '3'][observation]);
  },
});

behaves('spread/rest: component rest props forward through spreads with explicit overrides', {
  source: `
    function Field({ value, ...attributes }) { return <input {...attributes} value={value} />; }
    function Wrapper({ label, ...rest }) { return <label><span>{label}</span><Field {...rest} title={label} /></label>; }
    export function App() {
      let value = 'a'; let label = 'A';
      return <main><Wrapper id="field" label={label} value={value} title="overridden" onInput={event => { value = event.target.value; }} />
        <output>{value}</output><button id="label" onClick={() => { label = 'B'; }}>label</button></main>;
    }`,
  steps: [{ input: '#field', value: 'typed' }, { click: '#label' }],
  check(container, observation) {
    expect((container.querySelector('#field') as HTMLInputElement).value).toBe(['a', 'typed', 'typed'][observation]!);
    expect(container.querySelector('#field')?.getAttribute('title')).toBe(['A', 'A', 'B'][observation]);
    expect(container.querySelector('output')?.textContent).toBe(['a', 'typed', 'typed'][observation]);
  },
});

behaves('tag patterns: dynamic native tags change element type while keeping reactive props', {
  source: `
    export function App() {
      let Tag = 'h2'; let count = 1;
      return <main><section><Tag data-count={count}>{count}</Tag></section>
        <button id="count" onClick={() => count++}>count</button><button id="tag" onClick={() => { Tag = 'p'; }}>tag</button></main>;
    }`,
  steps: [{ click: '#count' }, { click: '#tag' }, { click: '#count' }],
  check(container, observation) {
    const child = container.querySelector('section')!.firstElementChild!;
    expect(child.tagName.toLowerCase()).toBe(['h2', 'h2', 'p', 'p'][observation]!);
    expect(child.textContent).toBe(['1', '2', '2', '3'][observation]!);
    expect(child.getAttribute('data-count')).toBe(['1', '2', '2', '3'][observation]!);
  },
});

behaves('tag patterns: member components preserve their own local state', {
  source: `
    const Panels = { Counter: ({ start }) => {
      let count = start;
      return <section><p>{count}</p><button id="child" onClick={() => count++}>child</button></section>;
    } };
    export function App() {
      let other = 0;
      return <main><Panels.Counter start={1} /><output>{other}</output><button id="other" onClick={() => other++}>other</button></main>;
    }`,
  steps: [{ click: '#child' }, { click: '#other' }, { click: '#child' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2', '2', '3'][observation]);
    expect(container.querySelector('output')?.textContent).toBe(['0', '0', '1', '1'][observation]);
  },
});

behaves('tag patterns: distinct components with the same name do not share local state', {
  source: `
    function make(label) { return function Counter() {
      let count = 0;
      return <section><p>{label}:{count}</p><button id="child" onClick={() => count++}>child</button></section>;
    }; }
    const First = make('A'); const Second = make('B');
    export function App() {
      let alternate = false; const Tag = alternate ? Second : First;
      return <main><Tag /><button id="switch" onClick={() => { alternate = !alternate; }}>switch</button></main>;
    }`,
  steps: [{ click: '#child' }, { click: '#switch' }, { click: '#child' }, { click: '#switch' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['A:0', 'A:1', 'B:0', 'B:1', 'A:0'][observation]); },
});

behaves('recursive patterns: recursive components keep per-node state and remount removed descendants', {
  source: `
    function Branch({ node }) {
      let open = true; let count = 0;
      return <li data-id={node.id}><span>{node.name}:{count}</span>
        <button id={'inc-' + node.id} onClick={() => count++}>inc</button>
        <button id={'toggle-' + node.id} onClick={() => { open = !open; }}>toggle</button>
        {open && <ul>{node.children.map(child => <Branch key={child.id} node={child} />)}</ul>}</li>;
    }
    export function App() {
      const tree = { id: 'r', name: 'R', children: [{ id: 'a', name: 'A', children: [] }] };
      return <main><ul><Branch node={tree} /></ul><button id="rename" onClick={() => { tree.children[0].name = 'AA'; }}>rename</button>
        <button id="add" onClick={() => tree.children.push({ id: 'b', name: 'B', children: [] })}>add</button></main>;
    }`,
  steps: [{ click: '#inc-a' }, { click: '#rename' }, { click: '#toggle-r' }, { click: '#add' }, { click: '#toggle-r' }],
  check(container, observation) {
    expect([...container.querySelectorAll('li > span')].map(node => node.textContent)).toEqual([
      ['R:0', 'A:0'], ['R:0', 'A:1'], ['R:0', 'AA:1'], ['R:0'], ['R:0'], ['R:0', 'AA:0', 'B:0'],
    ][observation]!);
  },
});

behaves('recursive patterns: recursive JSX helpers update nested arrays and replacement branches', {
  compileTimeoutMs: 15000,
  source: `
    function draw(nodes) { return nodes.map(node => <li key={node.id}><span>{node.name}</span>
      {node.children.length > 0 ? <ul>{draw(node.children)}</ul> : null}</li>); }
    export function App() {
      let nodes = [{ id: 'a', name: 'A', children: [{ id: 'b', name: 'B', children: [] }] }];
      const view = draw(nodes);
      return <main><ul id="tree">{view}</ul><button id="rename" onClick={() => { nodes[0].children[0].name = 'BB'; }}>rename</button>
        <button id="add" onClick={() => nodes[0].children.push({ id: 'c', name: 'C', children: [] })}>add</button>
        <button id="replace" onClick={() => { nodes = [{ id: 'd', name: 'D', children: [] }]; }}>replace</button></main>;
    }`,
  steps: [{ click: '#rename' }, { click: '#add' }, { click: '#replace' }],
  check(container, observation) { expect(container.querySelector('#tree')?.textContent).toBe(['AB', 'ABB', 'ABBC', 'D'][observation]); },
});
