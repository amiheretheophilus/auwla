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
