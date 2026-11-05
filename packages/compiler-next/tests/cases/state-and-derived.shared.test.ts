/** Phase 3 shared owners without requiring JSX component calls. */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

const show = (values: string[]) => (root: HTMLElement, index: number) => {
  expect(root.querySelector('p')!.textContent).toBe(values[index]!);
};

behaves('shared: factory invocations keep independent state, memos and takeover', {
  source: `function create(start) {
    let count = start;
    let twice = count * 2;
    return { read: () => twice, inc() { count++; }, take() { twice = 99; } };
  }
  const first = create(1), second = create(10);
  export function App() {
    const shown = first.read() + ':' + second.read();
    return <main><p>{shown}</p>
      <button id="first" onClick={() => first.inc()}>first</button>
      <button id="second" onClick={() => second.inc()}>second</button>
      <button id="take" onClick={() => first.take()}>take</button></main>;
  }`,
  steps: [{ click: '#first' }, { click: '#second' }, { click: '#take' }, { click: '#first' }],
  check: show(['2:20', '4:20', '4:22', '99:22', '99:22']),
});

behaves('shared: reexported bindings keep live reads and module derivation', {
  modules: {
    './data/store.ts': `export let count = 1; export let twice = count * 2;
      export function inc() { count++; } export function take() { twice = 99; }`,
    './bridge.ts': `export { count as amount, twice, inc, take } from './data/store';`,
  },
  source: `import { amount, twice, inc, take } from './bridge';
    export function App() { return <main><p>{amount}:{twice}</p>
      <button id="inc" onClick={inc}>inc</button><button id="take" onClick={take}>take</button></main>; }`,
  steps: [{ click: '#inc' }, { click: '#take' }, { click: '#inc' }],
  check: show(['1:2', '2:4', '2:99', '3:99']),
});

behaves('shared: private fields and super stores notify receiver readers', {
  source: `class Base {
    #count = 1;
    get value() { return this.#count; }
    set value(value) { this.#count = value; }
  }
  class Counter extends Base { inc() { super.value++; } }
  const counter = new Counter();
  export function App() { const shown = counter.value * 2;
    return <main><p>{shown}</p><button onClick={() => counter.inc()}>inc</button></main>; }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check: show(['2', '4', '6']),
});

behaves('shared: a handler retains native intermediate reads before the update boundary', {
  source: `let count = 1; const twice = count * 2; const log = [];
    function inc() { count++; log.push(twice); }
    export function App() { return <main><p>{twice}:{log.join(',')}</p><button onClick={inc}>inc</button></main>; }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check: show(['2:', '4:2', '6:2,4']),
});

// A statement that can only run where it was written is never replayed (found in hono,
// modern-tar, fast-check). Each of these once compiled to a file that did not parse.
behaves('shared: a step that continues its enclosing loop stays where it was written', {
  source: `
    const routes = { a: [1], b: [2] };
    const table = { b: 'x' };
    function build() {
      const out = {};
      for (const path in routes) {
        const handlers = routes[path];
        const data = table[path];
        if (!data) {
          out[path] = handlers.map((h) => h);
          continue;
        }
        out[path] = handlers.map((h) => data + h);
      }
      return out;
    }
    export function App() {
      let n = 0;
      const built = build();
      return <main><p>{JSON.stringify(built)}:{n}</p><button onClick={() => n++}>n</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check: show(['{"a":[1],"b":["x2"]}:0', '{"a":[1],"b":["x2"]}:1']),
});

behaves('shared: a labelled jump out of nested loops stays where it was written', {
  source: `
    function first(rows) {
      let found = null;
      outer: for (const row of rows) {
        for (const cell of row) {
          const held = [cell];
          if (cell > 1) {
            held.push(cell);
            found = held;
            break outer;
          }
        }
      }
      return found;
    }
    export function App() {
      let n = 2;
      return <main><p>{String(first([[1], [n, 5]]))}</p><button onClick={() => n++}>n</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check: show(['2,2', '3,3']),
});

behaves('shared: a loop with its own continue still recomputes as one statement', {
  source: `
    export function App() {
      let n = 1;
      const seen = [];
      for (const key of ['a', 'b', 'c']) {
        const value = key + n;
        if (key === 'b') {
          seen.push(value + '!');
          continue;
        }
        seen.push(value);
      }
      return <main><p>{seen.join(',')}</p><button onClick={() => n++}>n</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check: show(['a1,b1!,c1', 'a2,b2!,c2']),
});

behaves('shared: a statement that awaits runs once, when its function reaches it', {
  source: `
    async function pack(entries) {
      let count = 0;
      const seen = [];
      await (async () => {
        for (const entry of entries) {
          seen.push(entry + count);
          count++;
        }
      })();
      return { list() { return seen.join(','); }, grow() { count++; } };
    }
    let packed = null;
    pack(['a', 'b']).then((value) => { packed = value; });
    export function App() {
      let n = 0;
      return <main><p>{packed === null ? 'none' : packed.list()}:{n}</p>
        <button onClick={() => { packed.grow(); n++; }}>grow</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check: show(['a0,b1:0', 'a0,b1:1']),
});
