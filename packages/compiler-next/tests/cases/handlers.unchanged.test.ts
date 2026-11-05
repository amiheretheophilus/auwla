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

// An effect runs after the commit, so it builds nothing, even with a derived value beside it.
behaves('an effect reading a derived number settles', {
  source: `
    export function App() {
      let s = 1;
      let n = s + 1;
      let runs = [];
      $effect(() => { runs.push(n); });
      return <main><button onClick={() => { s = 2; }}>go</button><p>{runs.join(',')}</p></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['2', '2,3'][observation]);
  },
});

behaves('an effect reading a derived array settles', {
  source: `
    export function App() {
      let s = [{ a: 1, b: 1 }];
      let n = s.filter((x) => x.a);
      let runs = [];
      $effect(() => { runs.push(n.length); });
      return <main><button onClick={() => { s[0].b = 2; }}>go</button><p>{runs.join(',')}</p></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '1,1'][observation]);
  },
});

behaves('an effect reading a derived value that keeps its value does not re-run', {
  source: `
    export function App() {
      let s = 1;
      let n = s > 0;
      let runs = [];
      $effect(() => { runs.push(n); });
      return <main><button onClick={() => { s = 2; }}>go</button><p>{runs.length}</p></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container) {
    expect(container.querySelector('p')?.textContent).toBe('1');
  },
});

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

/**
 * A known method's callback may write plain names without being observed, since that
 * edits no object and reports itself. Each case shows `rows[0].n` and `count` after go.
 */
function callback(name: string, setup: string, write: string, expected: string): void {
  behaves(`a callback writing a name: ${name}`, {
    source: `
      export function App() {
        let rows = [{ n: 1, tags: [1, 2] }];
        let count = 0;
        let last = null;
        ${setup}
        return <main>
          <button onClick={() => { ${write} }}>go</button>
          <p>{rows.length ? rows[0].n : 'none'}:{count}</p>
        </main>;
      }`,
    steps: [{ click: 'button' }],
    check(container, observation) {
      if (observation === 1) expect(container.querySelector('p')?.textContent).toBe(expected);
    },
  });
}

callback('it accumulates', '', 'rows.forEach((row) => { count += row.n; });', '1:1');
callback('it counts inside map', '', 'rows = rows.map((row) => ({ n: row.n + 1, tags: row.tags, id: count++ }));', '2:1');
callback('it counts in a nested call', '', 'rows.forEach((row) => { row.tags.forEach(() => { count++; }); });', '1:2');
callback('it replaces the list it walks', '', 'rows.forEach(() => { rows = []; });', 'none:0');
callback('it holds an item', '', 'rows.forEach((row) => { last = row; });', '1:0');
callback('through a function of the program', 'const bump = () => { count++; };', 'rows.forEach(() => bump());', '1:1');

// These edit an object as well, and must still show.
callback('it also edits the item', '', 'rows.forEach((row) => { count++; row.n = 2; });', '2:1');
callback('it edits through the name it wrote', '', 'rows.forEach((row) => { last = row; last.n = 2; });', '2:0');
callback('it edits by destructuring', '', 'rows.forEach((row) => { [row.n] = [2]; });', '2:0');
callback('it deletes a field', '', 'rows.forEach((row) => { count++; delete row.n; });', ':1');
callback('a function of the program edits', 'const edit = (row) => { row.n = 2; };', 'rows.forEach((row) => edit(row));', '2:0');

// A direct call of the program's own function follows the same rule as a callback.
callback('a direct call that writes a name', 'const pick = (id) => { count = id + 5; };', 'pick(rows[0].n);', '1:6');
callback('a direct call that keeps the item', 'const keep = (row) => { last = row; };', 'keep(rows[0]); last.n = 7;', '7:0');
callback('a direct call that edits what it gets', 'const edit = (row) => { row.n = 2; };', 'edit(rows[0]);', '2:0');
callback('a direct call edits through a name it wrote', 'const edit = (row) => { last = row; last.n = 2; };', 'edit(rows[0]);', '2:0');
callback('a direct call through another function that edits', 'const edit = (row) => { row.n = 2; }; const go = (row) => { edit(row); };', 'go(rows[0]);', '2:0');
callback('a direct call of a declared function', 'function pick(id) { count = id + 5; }', 'pick(rows[0].n);', '1:6');
callback('a call of a function that was replaced', 'let pick = () => {}; pick = (row) => { row.n = 2; };', 'pick(rows[0]);', '2:0');

behaves('a callback writing a name: module state', {
  source: `
    let total = 0;
    export function App() {
      let rows = [{ n: 4 }];
      return <main>
        <button onClick={() => { rows = rows.map((row) => { total += row.n; return row; }); }}>go</button>
        <p>{total}</p>
      </main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['0', '4'][observation]);
  },
});

behaves('a callback writing a name: the item it held can be edited later', {
  source: `
    export function App() {
      let rows = [{ n: 1 }];
      let last = null;
      return <main>
        <button id="hold" onClick={() => { rows.forEach((row) => { last = row; }); }}>hold</button>
        <button id="edit" onClick={() => { last.n = 2; }}>edit</button>
        <p>{rows[0].n}</p>
      </main>;
    }`,
  steps: [{ click: '#hold' }, { click: '#edit' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '1', '2'][observation]);
  },
});

behaves('a callback writing a name: a value built that way follows what it read', {
  source: `
    export function App() {
      let rows = [{ n: 1 }, { n: 2 }];
      let total = 0;
      rows.forEach((row) => { total += row.n; });
      return <main><button onClick={() => { rows[0].n = 5; }}>go</button><p>{total}</p></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['3', '7'][observation]);
  },
});

behaves('a callback writing a name: an effect reading the list does not re-run for it', {
  source: `
    export function App() {
      let rows = [{ n: 1 }];
      let count = 0;
      let runs = [];
      $effect(() => { runs.push(rows.length); });
      return <main>
        <button onClick={() => { rows.forEach(() => { count++; }); }}>go</button>
        <p>{runs.length}:{count}</p>
      </main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:0', '1:1'][observation]);
  },
});

/**
 * A step of a derived value is only watched if it can build what it was suspected of
 * (`optimize/methods.ts`). Each case shows `p` before and after the click.
 */
function step(name: string, setup: string, write: string, shown: string, expected: [string, string]): void {
  behaves(`a step of a derived value: ${name}`, {
    source: `
      export function App() {
        let search = 'A';
        let notes = [{ title: 'a' }, { title: 'b' }];
        ${setup}
        return <main><button onClick={() => { ${write} }}>go</button><p>{${shown}}</p></main>;
      }`,
    steps: [{ click: 'button' }],
    check(container, observation) {
      expect(container.querySelector('p')?.textContent).toBe(expected[observation]);
    },
  });
}

step('a filter that reads what it was given follows its inputs',
  'const q = search.toLowerCase(); const shown = notes.filter((note) => note.title.includes(q));',
  "search = 'B';", 'shown.map((note) => note.title).join("")', ['a', 'b']);
step('the value it was given follows its input',
  'const q = search.toLowerCase(); const shown = notes.filter((note) => note.title.includes(q));',
  "search = 'B';", 'q', ['a', 'b']);
step('a value it was given keeps a later edit',
  'let q = search.toLowerCase(); const shown = notes.filter((note) => note.title.includes(q));',
  "q = 'b';", 'shown.length + q', ['1a', '1b']);
step('a conversion that edits what it converts',
  'const box = { n: 0, valueOf() { this.n++; return 1; } }; const shown = notes.slice(box);',
  "search = 'B';", 'box.n + ":" + shown.length', ['1:1', '1:1']);
step('a callback that writes a name during the call',
  'let total = 0; Array.from(notes, (note) => { total += 1; return note; });',
  "notes = [{ title: 'c' }];", 'total', ['2', '1']);
step('a callback that edits an object during the call',
  'const box = { n: 0 }; JSON.stringify(notes, (key, value) => { box.n++; return value; });',
  "search = 'B';", 'box.n > 0 ? "edited" : "not"', ['edited', 'edited']);
step('a timer that writes later',
  'let later = 0; queueMicrotask(() => { later = 5; });',
  "search = 'B';", 'later + search', ['5A', '5B']);
step('an effect-free call between two values',
  'let q = notes.length; console.log(q); const shown = q + 1;',
  "notes = [];", 'q + ":" + shown', ['2:3', '0:1']);

// A ref that can only hold a node is not observed, and a call on it still works.
behaves('a call on a node ref runs its own listeners, and their writes show', {
  source: `
    export function App() {
      let target;
      let clicks = 0;
      return <main>
        <button id="target" ref={target} onClick={() => { clicks++; }}>target</button>
        <button id="go" onClick={() => { target?.click(); }}>go</button>
        <p>{clicks}</p>
      </main>;
    }`,
  steps: [{ click: '#go' }, { click: '#go' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(String(observation));
  },
});

behaves('a call on a ref that also holds an object still shows its edit', {
  source: `
    export function App() {
      let box = { n: 1, bump() { this.n++; } };
      return <main>
        <i ref={(node) => {}} />
        <button onClick={() => { box.bump(); }}>go</button>
        <p>{box.n}</p>
      </main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
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
