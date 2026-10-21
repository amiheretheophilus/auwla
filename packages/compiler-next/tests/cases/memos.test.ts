/** Local memo replay cases for wiki/compiler/state-and-derived.md. */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

behaves('memo chain follows local assignments', {
  source: `export function App() {
    let count = 1;
    const doubled = count * 2;
    const label = doubled + 1;
    return <main><p>{label}</p><button onClick={() => count++}>more</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['3', '5', '7'][observation]!);
  },
});

behaves('memo body loops reset their accumulator', {
  source: `export function App() {
    let limit = 3;
    let sum = 0;
    for (let i = 0; i < limit; i++) {
      if (i === 1) continue;
      if (i === 5) break;
      sum += i;
    }
    return <main><p>{sum}</p><button onClick={() => limit += 3}>more</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['2', '9', '9'][observation]!);
  },
});

behaves('memo switch branches replay with their inputs', {
  source: `export function App() {
    let mode = 0;
    let label;
    switch (mode) { case 0: label = 'zero'; break; case 1: label = 'one'; break; default: label = 'many'; }
    return <main><p>{label}</p><button onClick={() => mode++}>more</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['zero', 'one', 'many'][observation]!);
  },
});

behaves('memo patterns retain default and rest semantics', {
  source: `export function App() {
    let point = { x: 1, y: 2 };
    const { x = 4, ...rest } = point;
    const [first = x, ...tail] = [undefined, rest.y];
    return <main><p>{first}:{tail.join(',')}</p><button onClick={() => point = { y: 6 }}>move</button></main>;
  }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['1:2', '4:6'][observation]!);
  },
});

behaves('memo shared builder preserves both outputs', {
  source: `export function App() {
    let count = 1;
    let first = 0, second = 0;
    if (count > 0) { first += count; second += first * 2; }
    return <main><p>{first}:{second}</p><button onClick={() => count++}>more</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['1:2', '2:4', '3:6'][observation]!);
  },
});

behaves('memo shared builder keeps initializer reads internal to its group', {
  source: `export function App() {
    let count = 1;
    let first = count, second = first * 2;
    if (count > 0) { first += count; second += first; }
    return <main><p>{first}:{second}</p><button onClick={() => count++}>more</button></main>;
  }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')!.textContent).toBe(['2:4', '4:8', '6:12'][observation]!);
  },
});
