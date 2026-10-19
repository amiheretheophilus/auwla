/**
 * Cases for wiki/compiler/conditionals-and-lists.md.
 */
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
