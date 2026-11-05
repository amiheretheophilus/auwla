/**
 * What counts as a change (`wiki/decisions.md`, 2026-11-05): a write that leaves the
 * same primitive or the same field value re-runs nothing, and a new object is a change.
 * Also edits with no name to hold what they edit (`first().count++`).
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

/** An effect reading `value` that records each run where the page shows it. */
function counted(setup: string, write: string): string {
  return `
    export function App() {
      ${setup}
      let runs = [];
      $effect(() => { runs.push(JSON.stringify(value) === undefined ? 0 : 1); });
      return <main>
        <button onClick={() => { ${write} }}>go</button>
        <p>{runs.length}</p>
      </main>;
    }`;
}

function reruns(name: string, setup: string, write: string, expected: number): void {
  behaves(`what counts as a change: ${name}`, {
    source: counted(setup, write),
    steps: [{ click: 'button' }],
    check(container, observation) {
      if (observation === 1) expect(container.querySelector('p')?.textContent).toBe(String(expected));
    },
  });
}

// Nothing changed.
reruns('the same variable', 'let value = 1;', 'value = value;', 1);
reruns('the same number', 'let value = 1;', 'value = 1;', 1);
reruns('adding nothing', 'let value = 1;', 'value += 0;', 1);
reruns('the same NaN', 'let value = NaN;', 'value = NaN;', 1);
reruns('the same field value', 'let value = { a: 1 };', 'value.a = 1;', 1);
reruns('the same element', 'let value = [{ a: 1 }];', 'value[0] = value[0];', 1);
reruns('deleting what is not there', 'let value = { a: 1 };', 'delete value.b;', 1);
reruns('sorting what is sorted', 'let value = [1, 2];', 'value.sort();', 1);

// Something changed.
reruns('another number', 'let value = 1;', 'value = 2;', 2);
reruns('an increment', 'let value = 1;', 'value++;', 2);
reruns('another field value', 'let value = { a: 1 };', 'value.a = 2;', 2);
reruns('a new field', 'let value = { a: 1 };', 'value.b = 1;', 2);
reruns('deleting a field', 'let value = { a: 1 };', 'delete value.a;', 2);
reruns('a new object with the same fields', 'let value = { a: 1 };', 'value = { ...value };', 2);
reruns('a new array with the same items', 'let value = [{ a: 1 }];', 'value = value.slice();', 2);
reruns('a new object in a field', 'let value = { c: { a: 1 } };', 'value.c = { a: 1 };', 2);

behaves('what counts as a change: a same-value write updates nothing it did not change', {
  source: `
    export function App() {
      let count = 1;
      return <main><button onClick={() => { count = 1; }}>same</button><p>{count}</p></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container) {
    expect(container.querySelector('p')?.textContent).toBe('1');
  },
});

behaves('what counts as a change: a same-value write in module state', {
  source: `
    let count = 1;
    let renders = 0;
    export function App() {
      return <main>
        <button id="same" onClick={() => { count = 1; }}>same</button>
        <button id="next" onClick={() => { count = 2; }}>next</button>
        <p>{count}</p>
      </main>;
    }`,
  steps: [{ click: '#same' }, { click: '#next' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '1', '2'][observation]);
  },
});

behaves('an edit through a call updates: a field', {
  source: `
    export function App() {
      let rows = [{ n: 1 }];
      const first = () => rows[0];
      return <main><button onClick={() => { first().n = 2; }}>go</button><p>{rows[0].n}</p></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('an edit through a call updates: an increment', {
  source: `
    export function App() {
      let rows = [{ n: 1 }];
      const first = () => rows[0];
      return <main><button onClick={() => { first().n++; }}>go</button><p>{rows[0].n}</p></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('an edit through a call updates: a delete', {
  source: `
    export function App() {
      let rows = [{ n: 1 }];
      const first = () => rows[0];
      return <main><button onClick={() => { delete first().n; }}>go</button><p>{String(rows[0].n)}</p></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', 'undefined'][observation]);
  },
});

behaves('an edit through a call updates: a known method, and the call runs once', {
  source: `
    const count = { calls: 0 };
    export function App() {
      let rows = [{ tags: [] }];
      const first = () => { count.calls += 1; return rows[0]; };
      return <main>
        <button onClick={() => { first().tags.push(1); }}>go</button>
        <p>{rows[0].tags.length}:{count.calls}</p>
      </main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['0:0', '1:1'][observation]);
  },
});

behaves('an edit through a call updates: an unknown method, and the call runs once', {
  source: `
    const count = { calls: 0 };
    const make = () => ({ n: 1, touch() { this.n += 1; } });
    export function App() {
      let rows = [make()];
      const first = () => { count.calls += 1; return rows[0]; };
      return <main>
        <button onClick={() => { first().touch(); }}>go</button>
        <p>{rows[0].n}:{count.calls}</p>
      </main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:0', '2:1'][observation]);
  },
});
