/**
 * Cases for wiki/compiler/refs.md.
 */
import { behaves } from '../harness/run';

behaves('a ref used in a handler', {
  source: `
    export function App() {
      let input;
      return <main><input ref={input} /><button onClick={() => { input.value = 'filled'; }}>fill</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('markup that reads a ref updates when it mounts', {
  source: `
    export function App() {
      let box;
      return <main><div ref={box} /><p>{box ? box.tagName : 'none'}</p></main>;
    }`,
});

behaves('a ref is cleared when its element leaves', {
  source: `
    export function App() {
      let show = true;
      let box;
      return (
        <main>
          {show && <div ref={box} />}
          <p>{box ? 'mounted' : 'gone'}</p>
          <button onClick={() => (show = false)}>hide</button>
        </main>
      );
    }`,
  steps: [{ click: 'button' }],
});

behaves('a member expression as a ref', {
  source: `
    export function App() {
      const nodes = {};
      return <main><section ref={nodes.panel} /><p>{nodes.panel ? 'panel' : 'none'}</p></main>;
    }`,
});

behaves('a callback ref that writes state', {
  source: `
    export function App() {
      let tag = '';
      return <main><div ref={(node) => { tag = node.tagName.toLowerCase(); }} /><p>{tag}</p></main>;
    }`,
});

behaves('several refs on one element', {
  source: `
    export function App() {
      let first;
      let seen = 0;
      return <main><div ref={[first, () => { seen++; }]} /><p>{first ? 'first' : 'none'} {seen}</p></main>;
    }`,
});

behaves('a ref forwarded through a component', {
  source: `
    function Field({ ref: forwarded }) {
      return <label><input ref={forwarded} /></label>;
    }
    export function App() {
      let email;
      return <main><Field ref={email} /><button onClick={() => { email.value = 'a@b.c'; }}>fill</button></main>;
    }`,
  steps: [{ click: 'button' }],
});
