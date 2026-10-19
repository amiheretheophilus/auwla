/**
 * Cases for wiki/compiler/state-and-derived.md.
 */
import { behaves } from '../harness/run';

behaves('a counter', {
  source: `
    export function App() {
      let count = 0;
      return <button onClick={() => count++}>{count}</button>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
});

behaves('a const derived from state follows it', {
  source: `
    export function App() {
      let qty = 1;
      const total = 10 * qty;
      return <main><p>{total}</p><button onClick={() => qty++}>+1</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a binding reassigned in a handler is a snapshot', {
  source: `
    export function App() {
      let price = 10;
      let qty = 1;
      let total = price * qty;
      return (
        <main>
          <p>{total}</p>
          <button id="more" onClick={() => qty++}>+1</button>
          <button id="reset" onClick={() => (total = 0)}>reset</button>
        </main>
      );
    }`,
  steps: [{ click: '#more' }, { click: '#reset' }, { click: '#more' }],
});

behaves('body writes are part of the derivation', {
  source: `
    export function App() {
      let user = { name: '' };
      let label = user.name;
      if (!label) label = 'Anonymous';
      return <main><p>{label}</p><button onClick={() => (user = { name: 'Ada' })}>sign in</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('an if/else that assigns in every branch', {
  source: `
    export function App() {
      let user = { name: '' };
      let label;
      if (user.name) label = user.name;
      else label = 'Anonymous';
      return <main><p>{label}</p><button onClick={() => (user = { name: 'Ada' })}>sign in</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a loop in the body re-runs', {
  source: `
    export function App() {
      let items = [{ price: 1 }, { price: 2 }];
      let sum = 0;
      for (const item of items) sum += item.price;
      return <main><p>{sum}</p><button onClick={() => items.push({ price: 4 })}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a mutated derived copy keeps the edit until its source changes', {
  source: `
    export function App() {
      let items = [{ id: 1, name: 'b' }, { id: 2, name: 'a' }];
      const sorted = items.slice().sort((x, y) => x.name.localeCompare(y.name));
      return (
        <main>
          <ul>{sorted.map((item) => <li key={item.id}>{item.name}</li>)}</ul>
          <button id="zed" onClick={() => sorted.push({ id: 99, name: 'zed' })}>add zed</button>
          <button id="reload" onClick={() => (items = [{ id: 3, name: 'c' }])}>reload</button>
        </main>
      );
    }`,
  steps: [{ click: '#zed' }, { click: '#reload' }],
});

behaves('a call result that is written', {
  source: `
    function makeList() { return [1, 2]; }
    export function App() {
      const items = makeList();
      return <main><ul>{items.map((n) => <li key={n}>{n}</li>)}</ul><button onClick={() => items.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('writes on a concat result', {
  source: `
    export function App() {
      const xs = [1].concat([2]);
      return <main><p>{xs.join(',')}</p><button onClick={() => xs.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a reassigned prop holds until the parent sends a new value', {
  source: `
    function Counter({ count }) {
      return <button id="child" onClick={() => count++}>{count}</button>;
    }
    export function App() {
      let start = 0;
      return <main><Counter count={start} /><button id="parent" onClick={() => (start = 10)}>reset</button></main>;
    }`,
  steps: [{ click: '#child' }, { click: '#child' }, { click: '#parent' }, { click: '#child' }],
});

behaves('chained and value-position assignments', {
  source: `
    let a = 0;
    let b = 0;
    let count = 0;
    let last = -1;
    export function App() {
      return (
        <main>
          <p>{a}{b} {count}:{last}</p>
          <button id="chain" onClick={() => { a = b = 1; }}>chain</button>
          <button id="value" onClick={() => { last = count++; }}>value</button>
        </main>
      );
    }`,
  steps: [{ click: '#chain' }, { click: '#value' }],
});

behaves('a module value derived from module state is written', {
  source: `
    let items = [1];
    let count = items.length;
    export function App() {
      return <main><p>{count}</p><button onClick={() => { count = 0; }}>zero</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('destructuring reactive state', {
  source: `
    export function App() {
      let point = { x: 1, y: 2 };
      const { x, y } = point;
      return <main><p>{x},{y}</p><button onClick={() => (point = { x: 5, y: 6 })}>move</button></main>;
    }`,
  steps: [{ click: 'button' }],
});
