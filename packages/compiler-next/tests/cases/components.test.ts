/**
 * Cases for wiki/compiler/components.md.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

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
