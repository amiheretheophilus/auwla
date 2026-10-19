/**
 * Cases for wiki/compiler/handlers.md.
 */
import { behaves } from '../harness/run';

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
