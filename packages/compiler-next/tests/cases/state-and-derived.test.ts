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

behaves('complex state: module instances are shared while component instances stay independent', {
  source: `
    class Counter { constructor(value) { this.value = value; } get doubled() { return this.value * 2; } add() { this.value++; } }
    const shared = new Counter(10);
    function Panel({ id }) {
      const local = new Counter(1);
      const total = shared.doubled + local.doubled;
      return <section id={id}><output>{shared.value}:{local.value}:{total}</output>
        <button id={id + '-local'} onClick={() => local.add()}>local</button>
        <button id={id + '-shared'} onClick={() => shared.add()}>shared</button></section>;
    }
    export function App() { return <main><Panel id="a" /><Panel id="b" /></main>; }`,
  steps: [{ click: '#a-local' }, { click: '#b-shared' }, { click: '#b-local' }],
  check(container, observation) {
    expect(container.querySelector('#a output')?.textContent).toBe(['10:1:22', '10:2:24', '11:2:26', '11:2:26'][observation]);
    expect(container.querySelector('#b output')?.textContent).toBe(['10:1:22', '10:1:22', '11:1:24', '11:2:26'][observation]);
  },
});

behaves('complex state: constructor arguments rederive instances while unrelated writes preserve edits', {
  source: `
    let constructions = 0;
    class Counter { constructor(value) { constructions++; this.value = value; } add() { this.value++; } }
    export function App() {
      let seed = 1; let other = 0;
      const counter = new Counter(seed);
      return <main><p>{counter.value}:{constructions}:{other}</p>
        <button id="edit" onClick={() => counter.add()}>edit</button>
        <button id="other" onClick={() => other++}>other</button>
        <button id="seed" onClick={() => seed++}>seed</button></main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#other' }, { click: '#seed' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:1:0', '2:1:0', '2:1:1', '2:2:1'][observation]);
  },
});

behaves('complex state: a reassigned class instance keeps its constructor snapshot', {
  source: `
    class Counter { constructor(value) { this.value = value; } }
    export function App() {
      let seed = 1; let counter = new Counter(seed);
      return <main><p>{seed}:{counter.value}</p>
        <button id="seed" onClick={() => seed++}>seed</button>
        <button id="replace" onClick={() => { counter = new Counter(99); }}>replace</button></main>;
    }`,
  steps: [{ click: '#seed' }, { click: '#replace' }, { click: '#seed' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['1:1', '2:1', '2:99', '3:99'][observation]); },
});

behaves('complex state: getters setters and postfix writes preserve JavaScript results', {
  source: `
    class Meter {
      constructor(value) { this.raw = value; }
      get value() { return this.raw; }
      set value(next) { this.raw = Math.max(0, next); }
      get doubled() { return this.raw * 2; }
    }
    export function App() {
      const meter = new Meter(2); let previous = -1;
      const doubled = meter.doubled;
      return <main><p>{meter.value}:{doubled}:{previous}</p>
        <button id="inc" onClick={() => { previous = meter.value++; }}>inc</button>
        <button id="clamp" onClick={() => { meter.value = -5; }}>clamp</button></main>;
    }`,
  steps: [{ click: '#inc' }, { click: '#clamp' }, { click: '#inc' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['2:4:-1', '3:6:2', '0:0:2', '1:2:0'][observation]); },
});

behaves('complex state: inherited constructors accessors and overridden methods update derivations', {
  source: `
    class Base {
      constructor(value) { this.raw = value; }
      get value() { return this.raw; }
      set value(next) { this.raw = next; }
      add(amount) { this.value += amount; }
    }
    class Counter extends Base {
      constructor(value) { super(value); this.factor = 2; }
      get total() { return super.value * this.factor; }
      add(amount = 1) { super.add(amount * this.factor); }
    }
    export function App() {
      const counter = new Counter(3); const total = counter.total;
      return <main><p>{counter.value}:{total}</p><button onClick={() => counter.add()}>add</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['3:6', '5:10', '7:14'][observation]); },
});

behaves('complex state: static class fields and getters feed component derivations', {
  source: `
    class Totals { static count = 1; static get doubled() { return this.count * 2; } static add() { this.count++; } }
    function Summary() { const shown = Totals.doubled + 1; return <output>{shown}</output>; }
    export function App() { return <main><Summary /><Summary /><button onClick={() => Totals.add()}>add</button></main>; }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect([...container.querySelectorAll('output')].map(node => node.textContent)).toEqual([['3', '3'], ['5', '5'], ['7', '7']][observation]!);
  },
});

behaves('complex state: object getters and setters update derived values and child props', {
  source: `
    function Label({ value }) { return <output>{value}</output>; }
    export function App() {
      const model = { raw: 2, get value() { return this.raw; }, set value(next) { this.raw = next; }, get doubled() { return this.raw * 2; } };
      const label = model.doubled + '!';
      return <main><Label value={label} /><p>{model.value}</p><button onClick={() => { model.value += 3; }}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('output')?.textContent).toBe(['4!', '10!'][observation]);
    expect(container.querySelector('p')?.textContent).toBe(['2', '5'][observation]);
  },
});

behaves('complex state: an imported class store combines module and component changes', {
  modules: {
    './store.ts': `
      class Cart { constructor() { this.qty = 1; this.price = 5; } get total() { return this.qty * this.price; } add() { this.qty++; } }
      export const cart = new Cart(); export let tax = 1;
      export function increase() { cart.add(); } export function setTax(value) { tax = value; }`,
  },
  source: `
    import { cart, tax, increase, setTax } from './store';
    function Summary({ discount }) { const total = cart.total + tax - discount; return <output>{total}</output>; }
    export function App() {
      let discount = 0;
      return <main><Summary discount={discount} /><p>{cart.qty}:{tax}</p>
        <button id="cart" onClick={increase}>cart</button><button id="tax" onClick={() => setTax(3)}>tax</button>
        <button id="discount" onClick={() => { discount = 2; }}>discount</button></main>;
    }`,
  steps: [{ click: '#cart' }, { click: '#tax' }, { click: '#discount' }],
  check(container, observation) {
    expect(container.querySelector('output')?.textContent).toBe(['6', '11', '13', '11'][observation]);
    expect(container.querySelector('p')?.textContent).toBe(['1:1', '2:1', '2:3', '2:3'][observation]);
  },
});

behaves('complex state: constructors may return an ordinary object with methods', {
  source: `
    class Factory { constructor(value) { return { value, add() { this.value++; }, get label() { return 'v' + this.value; } }; } }
    export function App() {
      const model = new Factory(1); const label = model.label;
      return <main><p>{label}</p><button onClick={() => model.add()}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['v1', 'v2'][observation]); },
});

behaves('complex state: private fields remain usable through getters setters and methods', {
  source: `
    class Counter {
      #value;
      constructor(value) { this.#value = value; }
      get value() { return this.#value; }
      set value(next) { this.#value = next; }
      add() { this.#value++; }
    }
    export function App() {
      const counter = new Counter(1);
      return <main><p>{counter.value}</p><button id="add" onClick={() => counter.add()}>add</button>
        <button id="set" onClick={() => { counter.value = 10; }}>set</button></main>;
    }`,
  steps: [{ click: '#add' }, { click: '#set' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['1', '2', '10'][observation]); },
});

behaves('complex state: computed accessors and destructuring retain getter values and snapshots', {
  source: `
    const field = 'value';
    class Counter {
      constructor(value) { this.raw = value; }
      get [field]() { return this.raw; }
      set [field](next) { this.raw = next; }
    }
    export function App() {
      const counter = new Counter(2); const { value: derived } = counter; let saved = counter[field];
      return <main><p>{derived}:{saved}</p><button id="add" onClick={() => { counter[field] += 2; }}>add</button>
        <button id="save" onClick={() => { saved = counter[field]; }}>save</button></main>;
    }`,
  steps: [{ click: '#add' }, { click: '#save' }, { click: '#add' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['2:2', '4:2', '4:4', '6:4'][observation]); },
});

behaves('complex state: module setters can change several fields seen by sibling components', {
  source: `
    class Range {
      constructor() { this.low = 1; this.high = 3; }
      set center(next) { const width = this.high - this.low; this.low = next - width / 2; this.high = next + width / 2; }
      get label() { return this.low + '-' + this.high; }
    }
    const range = new Range();
    function Summary() { const label = range.label; return <output>{label}</output>; }
    export function App() { return <main><Summary /><Summary /><button onClick={() => { range.center = 5; }}>move</button></main>; }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect([...container.querySelectorAll('output')].map(node => node.textContent)).toEqual([['1-3', '1-3'], ['4-6', '4-6']][observation]!);
  },
});

behaves('complex state: dependency snapshots never invoke an unused own getter', {
  source: `
    class Counter {
      constructor() {
        this.value = 1;
        Object.defineProperty(this, 'unused', { enumerable: true, get() { throw new Error('unused getter executed'); } });
      }
      add() { this.value++; }
    }
    export function App() {
      const counter = new Counter(); const label = counter.value * 2;
      return <main><p>{label}</p><button onClick={() => counter.add()}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['2', '4'][observation]); },
});

behaves('complex state: symbol-backed accessors update cached derivations', {
  source: `
    const field = Symbol('value');
    class Counter {
      constructor() { this[field] = 1; }
      get value() { return this[field]; }
      set value(next) { this[field] = next; }
    }
    export function App() {
      const counter = new Counter(); const doubled = counter.value * 2;
      return <main><p>{counter.value}:{doubled}</p><button onClick={() => { counter.value++; }}>add</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['1:2', '2:4', '3:6'][observation]); },
});

behaves('spread/rest: array copy mutations survive unrelated writes until the source changes', {
  source: `
    export function App() {
      let b = [1, 2]; const a = [...b]; let other = 0;
      return <main><p>{a.join(',')}|{b.join(',')}|{other}</p>
        <button id="copy" onClick={() => a.push(9)}>copy</button><button id="other" onClick={() => other++}>other</button>
        <button id="source" onClick={() => b.push(3)}>source</button><button id="replace" onClick={() => { b = [4]; }}>replace</button></main>;
    }`,
  steps: [{ click: '#copy' }, { click: '#other' }, { click: '#source' }, { click: '#replace' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1,2|1,2|0', '1,2,9|1,2|0', '1,2,9|1,2|1', '1,2,3|1,2,3|1', '4|4|1'][observation]);
  },
});

behaves('spread/rest: object copy writes additions and deletions reset only with its source', {
  source: `
    export function App() {
      const b = { qty: 1, label: 'base' }; const a = { ...b }; let other = 0;
      return <main><p>{a.qty}:{a.label ?? '-'}:{a.extra ?? '-'}|{b.qty}:{b.label}|{other}</p>
        <button id="copy" onClick={() => { a.qty = 9; a.extra = 'local'; delete a.label; }}>copy</button>
        <button id="other" onClick={() => other++}>other</button><button id="source" onClick={() => b.qty++}>source</button></main>;
    }`,
  steps: [{ click: '#copy' }, { click: '#other' }, { click: '#source' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:base:-|1:base|0', '9:-:local|1:base|0', '9:-:local|1:base|1', '2:base:-|2:base|1'][observation]);
  },
});

behaves('spread/rest: array spread is shallow and nested mutations still reach the original', {
  source: `
    export function App() {
      const b = [{ value: 1 }]; const a = [...b];
      return <main><p>{a.map(item => item.value).join(',')}|{b.map(item => item.value).join(',')}|{a[0] === b[0] ? 'shared' : 'copied'}</p>
        <button id="append" onClick={() => a.push({ value: 9 })}>append</button>
        <button id="nested" onClick={() => a[0].value++}>nested</button></main>;
    }`,
  steps: [{ click: '#append' }, { click: '#nested' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1|1|shared', '1,9|1|shared', '2|2|shared'][observation]);
  },
});

behaves('spread/rest: object spread shares nested references while isolating top-level writes', {
  source: `
    export function App() {
      const b = { count: 1, nested: { value: 2 } }; const a = { ...b };
      return <main><p>{a.count}:{a.nested.value}|{b.count}:{b.nested.value}|{a.nested === b.nested ? 'shared' : 'copied'}</p>
        <button id="top" onClick={() => { a.count = 9; }}>top</button><button id="nested" onClick={() => a.nested.value++}>nested</button></main>;
    }`,
  steps: [{ click: '#top' }, { click: '#nested' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:2|1:2|shared', '9:2|1:2|shared', '1:3|1:3|shared'][observation]);
  },
});

behaves('spread/rest: array destructuring rest can be mutated and rederived', {
  source: `
    export function App() {
      const values = [1, 2, 3]; const [head, ...tail] = values;
      return <main><p>{head}|{tail.join(',')}|{values.join(',')}</p>
        <button id="tail" onClick={() => tail.push(9)}>tail</button><button id="source" onClick={() => values.push(4)}>source</button></main>;
    }`,
  steps: [{ click: '#tail' }, { click: '#source' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1|2,3|1,2,3', '1|2,3,9|1,2,3', '1|2,3,4|1,2,3,4'][observation]);
  },
});

behaves('spread/rest: computed object rest excludes selected keys and retains symbols', {
  source: `
    const token = Symbol('token'); const key = 'selected';
    export function App() {
      const source = { selected: 1, other: 2, [token]: 'S' }; const { [key]: selected, ...rest } = source;
      return <main><p>{selected}|{rest.other}:{rest[token]}:{Object.keys(rest).join(',')}</p>
        <button id="rest" onClick={() => { rest.other = 9; }}>rest</button><button id="source" onClick={() => { source.other = 3; }}>source</button></main>;
    }`,
  steps: [{ click: '#rest' }, { click: '#source' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1|2:S:other', '1|9:S:other', '1|3:S:other'][observation]);
  },
});

behaves('spread/rest: a reassigned rest binding is a snapshot while other aliases remain derived', {
  source: `
    export function App() {
      const source = { selected: 1, other: 2 }; let { selected, ...rest } = source;
      return <main><p>{selected}|{rest.other ?? '-'}:{rest.manual ?? '-'}</p>
        <button id="source" onClick={() => { source.selected++; source.other++; }}>source</button>
        <button id="rest" onClick={() => { rest = { manual: 9 }; }}>rest</button></main>;
    }`,
  steps: [{ click: '#source' }, { click: '#rest' }, { click: '#source' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1|2:-', '2|2:-', '2|-:9', '3|-:9'][observation]);
  },
});

behaves('spread/rest: rest parameters and spread arguments combine module and local changes', {
  source: `
    let factor = 2;
    function total(multiplier, ...values) { return multiplier * values.reduce((sum, value) => sum + value, 0); }
    export function App() {
      const values = [1, 2]; const result = total(factor, ...values);
      return <main><p>{result}</p><button id="values" onClick={() => values.push(3)}>values</button>
        <button id="factor" onClick={() => { factor = 3; }}>factor</button></main>;
    }`,
  steps: [{ click: '#values' }, { click: '#factor' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['6', '12', '18'][observation]); },
});

behaves('spread/rest: module and component copies each preserve local edits until their input changes', {
  source: `
    const source = [1]; const moduleCopy = [...source];
    export function App() {
      const localCopy = [...moduleCopy];
      return <main><p>{source.join(',')}|{moduleCopy.join(',')}|{localCopy.join(',')}</p>
        <button id="local" onClick={() => localCopy.push(8)}>local</button>
        <button id="module" onClick={() => moduleCopy.push(9)}>module</button>
        <button id="source" onClick={() => source.push(2)}>source</button></main>;
    }`,
  steps: [{ click: '#local' }, { click: '#module' }, { click: '#source' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1|1|1', '1|1|1,8', '1|1,9|1,9', '1,2|1,2|1,2'][observation]);
  },
});

behaves('spread/rest: nested rest patterns preserve defaults and react to deep writes', {
  source: `
    export function App() {
      const payload = { profile: { role: 'reader' }, items: [1, 2], version: 1 };
      const { profile: { name = 'Anonymous', ...meta }, items: [first, ...tail], ...remaining } = payload;
      return <main><p>{name}:{meta.role}|{first}:{tail.join(',')}|{remaining.version}</p>
        <button onClick={() => { payload.profile.name = 'Ada'; payload.profile.role = 'admin'; payload.items.push(3); payload.version++; }}>update</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['Anonymous:reader|1:2|1', 'Ada:admin|1:2,3|2'][observation]);
  },
});

behaves('recursive patterns: mutually recursive helpers rederive from nested state', {
  source: `
    let factor = 1;
    function sum(node) { return node.value + childrenTotal(node.children); }
    function childrenTotal(nodes) { return nodes.reduce((total, node) => total + sum(node), 0); }
    export function App() {
      const tree = { value: 1, children: [{ value: 2, children: [] }] }; const total = sum(tree) * factor;
      return <main><p>{total}</p><button id="nested" onClick={() => tree.children[0].value++}>nested</button>
        <button id="add" onClick={() => tree.children.push({ value: 4, children: [] })}>add</button>
        <button id="factor" onClick={() => { factor = 2; }}>factor</button></main>;
    }`,
  steps: [{ click: '#nested' }, { click: '#add' }, { click: '#factor' }],
  check(container, observation) { expect(container.querySelector('p')?.textContent).toBe(['3', '4', '8', '16'][observation]); },
});
