/**
 * Cases for wiki/compiler/conditionals-and-lists.md.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

behaves('a list from a call result', {
  source: `
    let items = [1, 2];
    function load() { return items; }
    export function App() {
      return <main><ul>{load().map((n) => <li key={n}>{n}</li>)}</ul><button onClick={() => items.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a list callback that uses the whole array', {
  source: `
    export function App() {
      let items = ['a', 'b'];
      return (
        <main>
          <ul>{items.map((item, index, all) => <li key={item}>{item} {index + 1}/{all.length}</li>)}</ul>
          <button onClick={() => items.push('c')}>add</button>
        </main>
      );
    }`,
  steps: [{ click: 'button' }],
});

behaves('JSX pushed into an array in a loop', {
  source: `
    export function App() {
      let items = [1, 2];
      const rows = [];
      for (const n of items) rows.push(<li key={n}>{n}</li>);
      return <main><ul>{rows}</ul><button onClick={() => items.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a key outside a list', {
  source: `
    export function App() {
      return <p key="x">hello</p>;
    }`,
});

behaves('a dynamic key outside a list remounts', {
  source: `
    function Field() {
      let draft = 'start';
      return <input value={draft} onInput={(event) => (draft = event.target.value)} />;
    }
    export function App() {
      let id = 1;
      return <main><Field key={id} /><button onClick={() => id++}>next</button></main>;
    }`,
  steps: [{ input: 'input', value: 'typed' }, { click: 'button' }],
});

behaves('a map over a module constant', {
  source: `
    const ITEMS = [1, 2];
    export function App() {
      return <main><ul>{ITEMS.map((n) => <li key={n}>{n}</li>)}</ul><button onClick={() => ITEMS.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('filter then map', {
  source: `
    export function App() {
      let items = [1, 2, 3, 4];
      return (
        <main>
          <ul>{items.filter((n) => n % 2 === 0).map((n) => <li key={n}>{n}</li>)}</ul>
          <button onClick={() => items.push(6)}>add</button>
        </main>
      );
    }`,
  steps: [{ click: 'button' }],
});

behaves('a switch on state in the body', {
  source: `
    export function App() {
      let mode = 'a';
      let view;
      switch (mode) {
        case 'a': view = <p>first</p>; break;
        default: view = <p>other</p>;
      }
      return <main>{view}<button onClick={() => (mode = 'b')}>switch</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('nullish coalescing in JSX', {
  source: `
    export function App() {
      let name = null;
      return <main><p>{name ?? 'nobody'}</p><button onClick={() => (name = 'Ada')}>set</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('an early return', {
  source: `
    export function App() {
      let items = [];
      if (items.length === 0) return <button onClick={() => items.push(1)}>empty</button>;
      return <ul>{items.map((n) => <li key={n}>{n}</li>)}</ul>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('an inline array list follows its state input', {
  source: `
    export function App() {
      let a = 1;
      return <main><ul>{[a].map(n => <li key={n}>{n}</li>)}</ul>
        <button onClick={() => a++}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('ul')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('a map callback passed by function reference', {
  source: `
    function Row(item) { return <li>{item}</li>; }
    export function App() {
      let items = [1];
      return <main><ul>{items.map(Row)}</ul><button onClick={() => items.push(2)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('ul')?.textContent).toBe(['1', '12'][observation]);
  },
});

behaves('a literal key on interactive markup keeps state', {
  source: `
    export function App() {
      let n = 0;
      return <main key="root"><p key={'out'}>{n}</p>
        <button key="button" onClick={() => n++}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['0', '1'][observation]);
  },
});

behaves('a keyed component keeps state on unrelated updates and resets on each new key', {
  source: `
    function Counter({ label }) {
      let count = 0;
      return <section><p id="count">{label}:{count}</p>
        <button id={'inc-' + label} onClick={() => count++}>inc</button></section>;
    }
    export function App() {
      let user = 'a';
      let other = 0;
      return <main><p id="other-value">{other}</p><Counter key={user} label={user} />
        <button id="switch" onClick={() => { user = user === 'a' ? 'b' : 'a'; }}>switch</button>
        <button id="other" onClick={() => other++}>other</button></main>;
    }`,
  steps: [{ click: '#inc-a' }, { click: '#inc-a' }, { click: '#other' }, { click: '#switch' }, { click: '#switch' }],
  check(container, observation) {
    expect(container.querySelector('#count')?.textContent).toBe(['a:0', 'a:1', 'a:2', 'a:2', 'b:0', 'a:0'][observation]);
  },
});

const previousPanels = new WeakMap<HTMLElement, globalThis.Element>();
behaves('a changed host key replaces the DOM node', {
  source: `
    export function App() {
      let version = 1;
      return <main><section id="panel" key={version}>v{version}</section>
        <button onClick={() => version++}>next</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    const panel = container.querySelector('#panel')!;
    expect(panel.textContent).toBe(['v1', 'v2'][observation]!);
    if (observation > 0) expect(panel).not.toBe(previousPanels.get(container));
    previousPanels.set(container, panel);
  },
});

behaves('keys work at a component root and inside conditional branches', {
  source: `
    function Counter({ label }) {
      let count = 0;
      return <section><p id="count">{label}:{count}</p>
        <button id={'inc-' + label} onClick={() => count++}>inc</button></section>;
    }
    function Shell({ name }) {
      return <Counter key={name} label={name} />;
    }
    export function App() {
      let name = 'x';
      let on = true;
      return <main>{on ? <Shell key={name} name={name} /> : <p id="off">off</p>}
        <button id="rename" onClick={() => { name = name + 'x'; }}>rename</button>
        <button id="toggle" onClick={() => { on = !on; }}>toggle</button></main>;
    }`,
  steps: [{ click: '#inc-x' }, { click: '#rename' }, { click: '#toggle' }, { click: '#toggle' }],
  check(container, observation) {
    expect(container.querySelector('#count, #off')?.textContent).toBe(['x:0', 'x:1', 'xx:0', 'off', 'xx:0'][observation]);
  },
});

behaves('a key on a returned component root remounts without a keyed parent', {
  source: `
    function Counter({ label }) {
      let count = 0;
      return <section><p>{label}:{count}</p><button id="inc" onClick={() => count++}>inc</button></section>;
    }
    function Shell({ name }) {
      return <Counter key={name} label={name} />;
    }
    export function App() {
      let name = 'a';
      return <main><Shell name={name} />
        <button id="rename" onClick={() => { name = name + 'a'; }}>rename</button></main>;
    }`,
  steps: [{ click: '#inc' }, { click: '#rename' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['a:0', 'a:1', 'aa:0'][observation]);
  },
});
