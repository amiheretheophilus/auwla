/**
 * Cases for wiki/compiler/handlers.md.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

for (const [name, key, body] of [
  ['replacing an own array method', 'push', `const box = []; box.push = () => { rows[0].label = 'z'; }; box.push();`],
  ['replacing a computed array method', 'push', `const box = []; box[key] = () => { rows[0].label = 'z'; }; box.push();`],
  ['replacing an array prototype', '__proto__', `const box = []; box.__proto__ = proto; box.push();`],
  ['replacing an object prototype', '__proto__', `const box = {}; box.__proto__ = proto; box.value = 'z';`],
  ['replacing a computed object prototype', '__proto__', `const box = {}; box[key] = proto; box.value = 'z';`],
  ['building a prototype key by concatenation', '__proto__', `let name = '__'; name += 'proto__'; const box = {}; box[name] = proto; box.value = 'z';`],
] as const) {
  behaves(`a helper observes effects after ${name}`, {
    source: `
      function prototypeFor(rows) {
        return {
          set value(next) { rows[0].label = next; },
          push() { rows[0].label = 'z'; }
        };
      }
      function help(rows, key, proto) { ${body} return rows; }
      export function App() {
        let rows = [{ label: 'a' }];
        const key = '${key}';
        const proto = prototypeFor(rows);
        return <main><p>{rows[0].label}</p>
          <button onClick={() => { help(rows, key, proto); }}>go</button></main>;
      }`,
    steps: [{ click: 'button' }],
    check(container, observation) {
      expect(container.querySelector('p')?.textContent).toBe(observation === 0 ? 'a' : 'z');
    },
  });
}

for (const [name, helper] of [
  ['own setter', `const box = { set value(next) { rows[0].label = next; } }; box.value = 'z';`],
  ['inherited setter', `const box = { __proto__: { set value(next) { rows[0].label = next; } } }; box.value = 'z';`],
  ['own getter', `const box = { get value() { rows[0].label = 'z'; return 1; } }; const read = box.value;`],
] as const) {
  behaves(`a helper observes effects from a fresh object's ${name}`, {
    source: `
      function help(rows) { ${helper} return rows; }
      export function App() {
        let rows = [{ label: 'a' }];
        return <main><p>{rows[0].label}</p>
          <button onClick={() => { help(rows); }}>go</button></main>;
      }`,
    steps: [{ click: 'button' }],
    check(container, observation) {
      expect(container.querySelector('p')?.textContent).toBe(observation === 0 ? 'a' : 'z');
    },
  });
}

for (const [name, body] of [
  ["a fresh object's computed store key", 'const box = { value: 0 }; box[key] = 1;'],
  ["a fresh array's computed store key", 'const box = [0]; box[key] = 1;'],
  ['a computed object literal key', 'const box = { [key]: 1 };'],
] as const) {
  behaves(`a helper observes conversion of ${name}`, {
    source: `
      function keyFor(rows) {
        return { [Symbol.toPrimitive]() { rows[0].label = 'z'; return 'value'; } };
      }
      function help(rows, key) { ${body} return rows; }
      export function App() {
        let rows = [{ label: 'a' }];
        const key = keyFor(rows);
        return <main><p>{rows[0].label}</p>
          <button onClick={() => { help(rows, key); }}>go</button></main>;
      }`,
    steps: [{ click: 'button' }],
    check(container, observation) {
      expect(container.querySelector('p')?.textContent).toBe(observation === 0 ? 'a' : 'z');
    },
  });
}

behaves('a helper preserves a setter edit before the setter throws', {
  source: `
    function help(rows) {
      const box = { set value(next) { rows[0].label = next; throw new Error('setter'); } };
      box.value = 'z';
      return rows;
    }
    export function App() {
      let rows = [{ label: 'a' }];
      let error = '';
      return <main><p>{rows[0].label}</p><output>{error}</output>
        <button onClick={() => { try { help(rows); } catch (caught) { error = caught.message; } }}>go</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(observation === 0 ? 'a' : 'z');
    expect(container.querySelector('output')?.textContent).toBe(observation === 0 ? '' : 'setter');
  },
});

behaves('an unlisted array method works directly and through a helper', {
  source: `
    function install(rows) {
      Object.defineProperty(rows, 'renameFirst', {
        value() { this[0].label += '!'; return this; }
      });
    }
    function help(rows) { return rows.renameFirst(); }
    export function App() {
      let rows = [{ label: 'a' }];
      install(rows);
      const name = 'renameFirst';
      return <main><p>{rows[0].label}</p>
        <button id="direct" onClick={() => { rows[name](); }}>direct</button>
        <button id="helper" onClick={() => { help(rows); }}>helper</button></main>;
    }`,
  steps: [{ click: '#direct' }, { click: '#helper' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['a', 'a!', 'a!!'][observation]);
  },
});

behaves('a helper observes mutations from a named array callback', {
  source: `
    function help(rows, callback) { return rows.map(callback); }
    function edit(row) { row.label = 'z'; return row; }
    export function App() {
      let rows = [{ label: 'a' }];
      return <main><p>{rows[0].label}</p>
        <button onClick={() => { help(rows, edit); }}>go</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(observation === 0 ? 'a' : 'z');
  },
});

behaves('a helper observes mutations from an array index conversion', {
  source: `
    function help(rows, start) { return rows.slice(start); }
    function startFor(rows) {
      return { valueOf() { rows[0].label = 'z'; return 0; } };
    }
    export function App() {
      let rows = [{ label: 'a' }];
      const start = startFor(rows);
      return <main><p>{rows[0].label}</p>
        <button onClick={() => { help(rows, start); }}>go</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(observation === 0 ? 'a' : 'z');
  },
});

behaves('a member expression as a handler', {
  source: `
    let count = 0;
    const actions = { go() { count++; } };
    export function App() {
      return <button onClick={actions.go}>{count}</button>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a call result as a handler', {
  source: `
    let count = 0;
    function make() { return () => { count += 2; }; }
    export function App() {
      return <button onClick={make()}>{count}</button>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('a write between two awaits shows', {
  source: `
    export function App() {
      let step = 'idle';
      async function run() {
        step = 'uploading';
        await defer('upload');
        step = 'processing';
        await defer('process');
        step = 'done';
      }
      return <main><p>{step}</p><button onClick={run}>go</button></main>;
    }`,
  steps: [{ click: 'button' }, { resolve: 'upload' }, { resolve: 'process' }],
});

behaves('a handler reassigns module state', {
  source: `
    let store = { n: 1 };
    export function App() {
      return <main><p>{store.n}</p><button onClick={() => { store = { n: 2 }; }}>set</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('typing into an input', {
  source: `
    export function App() {
      let text = '';
      return (
        <main>
          <input value={text} onInput={(event) => (text = event.target.value)} />
          <p>{text.toUpperCase()}</p>
        </main>
      );
    }`,
  steps: [{ input: 'input', value: 'hi' }],
});

behaves('an async helper preserves return await', {
  source: `
    async function load() { return await defer('load'); }
    export function App() {
      let result = 'waiting';
      return <main><p>{result}</p>
        <button onClick={() => { load().then(value => { result = value; }); }}>load</button></main>;
    }`,
  steps: [{ click: 'button' }, { resolve: 'load', value: 'ready' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['waiting', 'waiting', 'ready'][observation]);
  },
});
