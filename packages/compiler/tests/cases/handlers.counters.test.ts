/** Phase 3 local state and handler writes; memo replay is the following slice. */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

behaves('local writes: independent counters and direct text expressions', {
  source: `export function App() {
    let a = 0, b = 10;
    return <main><p>{a}:{b}:{a + b}</p>
      <button id="a" onClick={() => a++}>A</button><button id="b" onClick={() => b--}>B</button></main>;
  }`,
  steps: [{ click: '#a' }, { click: '#b' }, { click: '#a' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['0:10:10', '1:10:11', '1:9:10', '2:9:11'][observation]!);
  },
});

behaves('local writes: nested helpers batch until the event returns', {
  source: `export function App() {
    let count = 0, seen = '';
    function increment() { return count++; }
    function twice() {
      increment();
      seen = document.querySelector('#count').textContent;
      increment();
    }
    return <main><p id="count">{count}</p><output>{seen}</output><button onClick={twice}>go</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['0', '2', '4'][observation]!);
    expect(container.querySelector('output')!.textContent).toBe(['', '0', '2'][observation]!);
  },
});

behaves('local writes: assignment and postfix results survive nested operations', {
  source: `export function App() {
    let left = 0, right = 2, result = 0;
    function run() { result = (left = right++) + ++right; return result; }
    return <main><p>{left}:{right}:{result}</p><button onClick={run}>go</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['0:2:0', '2:4:6', '4:6:10'][observation]!);
  },
});

behaves('local writes: logical assignments preserve short-circuit evaluation', {
  source: `export function App() {
    let value = 0, calls = 0, output = '';
    function next() { calls++; return 5; }
    function run() { value &&= next(); value ||= next(); value ??= next(); output = value + ':' + calls; }
    return <main><p>{value}:{calls}:{output}</p><button onClick={run}>go</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['0:0:', '5:1:5:1', '5:2:5:2'][observation]!);
  },
});

behaves('local writes: destructuring retains its native assignment result', {
  source: `export function App() {
    let left = 1, right = 2, result = '';
    function swap() { result = ([left, right] = [right, left]).join(','); }
    return <main><p>{left}:{right}:{result}</p><button onClick={swap}>swap</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['1:2:', '2:1:2,1', '1:2:1,2'][observation]!);
  },
});

behaves('local writes: for-of and for-in targets notify after the loop', {
  source: `export function App() {
    let value = 0, key = '';
    function run() { for (value of [2, 4]) {} for (key in { a: 1, b: 2 }) {} }
    return <main><p>{value}:{key}</p><button onClick={run}>go</button></main>;
  }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['0:', '4:b'][observation]!);
  },
});

behaves('local writes: a timer callback notifies after invocation', {
  source: `export function App() {
    let count = 0;
    return <button onClick={() => setTimeout(() => { count += 2; }, 10)}>{count}</button>;
  }`,
  steps: [{ click: 'button' }, { advance: 10 }],
  check(container, observation) {
    expect(container.querySelector('button')!.textContent).toBe(['0', '0', '2'][observation]!);
  },
});

behaves('local writes: attributes properties and conditional event values update', {
  source: `export function App() {
    let enabled = false, count = 0;
    const one = () => { count += 1; };
    const two = () => { count += 2; };
    return <main><input type="checkbox" checked={enabled} />
      <p title={count}>{count}</p><button id="toggle" onClick={() => enabled = !enabled}>toggle</button>
      <button id="add" onClick={enabled ? two : one}>add</button></main>;
  }`,
  steps: [{ click: '#add' }, { click: '#toggle' }, { click: '#add' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['0', '1', '1', '3'][observation]!);
    expect(container.querySelector('p')!.title).toBe(['0', '1', '1', '3'][observation]!);
    expect(container.querySelector('input')!.checked).toBe(observation >= 2);
  },
});

behaves('local writes: repeated attributes retain their final literal on update', {
  source: `export function App() {
    let count = 0;
    return <button title={count} title="last" onClick={() => count++}>{count}</button>;
  }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('button')!.title).toBe('last');
    expect(container.querySelector('button')!.textContent).toBe(String(observation));
  },
});
