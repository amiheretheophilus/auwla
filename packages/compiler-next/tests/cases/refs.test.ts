/**
 * Cases for wiki/compiler/refs.md.
 */
import { expect } from 'bun:test';
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

behaves('a derivation of a ref updates after mount', {
  source: `
    export function App() {
      let box;
      const name = box?.tagName.toLowerCase() ?? 'none';
      return <main><p>{name}</p><section ref={box}>x</section></main>;
    }`,
  check(container) {
    expect(container.querySelector('p')?.textContent).toBe('section');
  },
});

behaves('ref readers follow replacement and removal and remount', {
  source: `
    export function App() {
      let box;
      let mode = 'a';
      return <main>
        {mode === 'a' ? <div id="first" ref={box}>a</div> : mode === 'b' ? <span id="second" ref={box}>b</span> : null}
        <p>{box?.id ?? 'none'}</p>
        <button onClick={() => { mode = mode === 'a' ? 'b' : mode === 'b' ? 'none' : 'a'; }}>next</button>
      </main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['first', 'second', 'none', 'first'][observation]);
  },
});

behaves('an effect owns the text of a ref node', {
  source: `
    export function App() {
      let host;
      let text = 'one';
      $effect(() => { if (host !== undefined) host.textContent = text; });
      return <main><div id="host" ref={host} />
        <button onClick={() => { text = 'two'; }}>next</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('#host')?.textContent).toBe(['one', 'two'][observation]);
  },
});

behaves('an effect first sees mounted refs and runs once per replacement', {
  source: `
    const runs = [];
    export function App() {
      let node;
      let mode = 'a';
      $effect(() => { runs.push(node?.id ?? 'none'); });
      return <main>
        {mode === 'a' ? <div id="first" ref={node}>a</div> : <div id="second" ref={node}>b</div>}
        <p>{runs.join(',')}</p>
        <button onClick={() => { mode = mode === 'a' ? 'b' : 'a'; }}>next</button>
      </main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['first', 'first,second'][observation]);
  },
});

behaves('each keyed row reads its own mounted ref', {
  source: `
    function Row({ label }) {
      let cell;
      return <li><span ref={cell}>{label}</span><b>{cell?.textContent ?? ''}</b></li>;
    }
    export function App() {
      let rows = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];
      return <main><ul>{rows.map(row => <Row key={row.id} label={row.label} />)}</ul>
        <button onClick={() => rows.push({ id: 3, label: 'three' })}>add</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('ul')?.textContent).toBe(['oneonetwotwo', 'oneonetwotwothreethree'][observation]);
  },
});
