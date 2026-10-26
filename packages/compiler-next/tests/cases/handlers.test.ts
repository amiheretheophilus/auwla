/**
 * Cases for wiki/compiler/handlers.md.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

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
