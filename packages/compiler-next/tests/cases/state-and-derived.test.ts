/**
 * Cases for wiki/compiler/state-and-derived.md.
 */
import { expect } from 'bun:test';
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

behaves('a body loop that only reads a list keeps what handlers pushed into it', {
  source: `
    export function App() {
      let others = [1, 2];
      let picked = [];
      let count = 0;
      for (const x of others) if (picked.includes(x)) count++;
      return (
        <main>
          <p>{picked.join(',')} {count}</p>
          <button id="pick" onClick={() => picked.push(1)}>pick</button>
          <button id="more" onClick={() => others.push(1)}>more</button>
        </main>
      );
    }`,
  steps: [{ click: '#pick' }, { click: '#more' }],
});

behaves('an unknown method that changes a value builds it', {
  source: `
    class Bag {
      items = [];
      add(x) { this.items.push(x); }
    }
    export function App() {
      let source = [1, 2];
      const bag = new Bag();
      for (const n of source) bag.add(n);
      return <main><p>{bag.items.join(',')}</p><button onClick={() => source.push(3)}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('an unknown method that only reads a value does not build it', {
  source: `
    class Bag {
      items = [];
      has(x) { return this.items.includes(x); }
    }
    export function App() {
      let others = [1, 2];
      const picked = new Bag();
      let count = 0;
      for (const x of others) if (picked.has(x)) count++;
      return (
        <main>
          <p>{picked.items.join(',')} {count}</p>
          <button id="pick" onClick={() => picked.items.push(2)}>pick</button>
          <button id="more" onClick={() => others.push(2)}>more</button>
        </main>
      );
    }`,
  steps: [{ click: '#pick' }, { click: '#more' }],
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

// Remaining regressions from root written-const-state, derived-literals,
// visible-effects and prop-writes. Existing cases above cover their other forms.
const writtenValues = [
  ['helper', 'function makeList() { return [1, 2]; }', 'const items = makeList();'],
  ['concat', '', 'const items = [1].concat([2]);'],
  ['spread member', 'const base = { a: 1 };', 'const items = { ...base, list: [1, 2] }.list;'],
  ['Array.from', '', 'const items = Array.from([1, 2]);'],
  ['let helper', 'function makeList() { return [1, 2]; }', 'let items = makeList();'],
];

for (const [name, prelude, declaration] of writtenValues) {
  for (const view of ['length', 'list']) {
    behaves(`written value from ${name} rendered as ${view}`, {
      source: `
        ${prelude}
        export function App() {
          ${declaration}
          return <main><button onClick={() => items.push(3)}>add</button>
            ${view === 'length' ? '<p id="out">{items.length}</p>' : '<ul id="out">{items.map(n => <li key={n}>{n}</li>)}</ul>'}
          </main>;
        }`,
      steps: [{ click: 'button' }],
      check(container, observation) {
        const expected = view === 'length' ? ['2', '3'] : ['12', '123'];
        expect(container.querySelector('#out')?.textContent).toBe(expected[observation]);
      },
    });
  }
}

behaves('a mutated object with a computed key', {
  source: `
    const key = 'a';
    export function App() {
      const counts = { [key]: 1 };
      return <main><p>{counts.a}</p><button onClick={() => counts.a++}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('a mutated object returned by a helper', {
  source: `
    function makeCounter() { return { value: 1 }; }
    export function App() {
      const counter = makeCounter();
      return <main><p>{counter.value}</p><button onClick={() => counter.value++}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('a handler reads an array-literal method chain', {
  source: `
    export function App() {
      let shown = '';
      const doubled = [1, 2].map(value => value * 2);
      return <main><p>{shown}</p><ul>{doubled.map(n => <li key={n}>{n}</li>)}</ul>
        <button onClick={() => { shown = doubled.join(','); }}>show</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['', '2,4'][observation]);
  },
});

for (const [name, declaration, read] of [
  ['array', 'const pair = [a, 2];', 'pair[0]'],
  ['object', 'const box = { a };', 'box.a'],
  ['new', 'const set = new Set([a]);', '[...set][0]'],
]) {
  behaves(`a ${name} initializer that reads state re-derives`, {
    source: `
      export function App() {
        let a = 1;
        ${declaration}
        return <main><p>{${read}}</p><button onClick={() => a++}>add</button></main>;
      }`,
    steps: [{ click: 'button' }],
    check(container, observation) {
      expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
    },
  });
}

behaves('reassigning a module object updates its readers', {
  source: `
    let store = { n: 1 };
    export function App() {
      return <main><p>{store.n}</p><button onClick={() => { store = { n: 2 }; }}>set</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('a mutated derived copy is rebuilt when its source is mutated', {
  source: `
    export function App() {
      let items = [3, 1];
      const sorted = items.slice();
      return <main><p>{sorted.length}</p>
        <button id="copy" onClick={() => sorted.push(0)}>copy</button>
        <button id="source" onClick={() => items.push(9)}>source</button></main>;
    }`,
  steps: [{ click: '#copy' }, { click: '#source' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['2', '3', '3'][observation]);
  },
});

behaves('a prop override survives updates to another prop', {
  source: `
    function Child({ label, other }) {
      return <section><p id="label">{label}</p><p id="seen">{other}</p>
        <button id="local" onClick={() => { label = label + '!'; }}>local</button></section>;
    }
    export function App() {
      let name = 'a';
      let other = 0;
      return <main><Child label={name} other={other} />
        <button id="rename" onClick={() => { name = name + 'a'; }}>rename</button>
        <button id="other" onClick={() => other++}>other</button></main>;
    }`,
  steps: [{ click: '#local' }, { click: '#other' }, { click: '#rename' }, { click: '#local' }],
  check(container, observation) {
    expect(container.querySelector('#label')?.textContent).toBe(['a', 'a!', 'a!', 'aa', 'aa!'][observation]);
    expect(container.querySelector('#seen')?.textContent).toBe(['0', '0', '1', '1', '1'][observation]);
  },
});

behaves('prop writes update derivations while local state keeps its snapshot', {
  source: `
    function Child({ label, other }) {
      let count = other;
      const loud = label.toUpperCase() + count;
      return <section><p>{loud}</p>
        <button id="local" onClick={() => { label = 'z'; count++; }}>local</button></section>;
    }
    export function App() {
      let name = 'a';
      return <main><Child label={name} other={0} />
        <button id="rename" onClick={() => { name = name + 'a'; }}>rename</button></main>;
    }`,
  steps: [{ click: '#local' }, { click: '#rename' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['A0', 'Z1', 'AA1'][observation]);
  },
});

behaves('each keyed row keeps its own prop override', {
  source: `
    function Row({ label }) {
      return <li><button id={'edit-' + label} onClick={() => { label = label.toUpperCase(); }}>e</button><span>{label}</span></li>;
    }
    export function App() {
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
      return <main><ul>{rows.map(row => <Row key={row.id} label={row.label} />)}</ul>
        <button id="add" onClick={() => rows.push({ id: 3, label: 'c' })}>add</button></main>;
    }`,
  steps: [{ click: '#edit-a' }, { click: '#add' }],
  check(container, observation) {
    expect(container.querySelector('ul')?.textContent).toBe(['eaeb', 'eAeb', 'eAebec'][observation]);
  },
});
