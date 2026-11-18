/**
 * A function is a value like any other (`wiki/compiler/state-and-derived.md`, "Function values"),
 * and a module's body builds values the way a component's does.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

function paragraph(values: readonly string[]) {
  return (container: HTMLElement, observation: number): void => {
    expect(container.querySelector('p')?.textContent).toBe(values[observation]!);
  };
}

const button = '<button id="go" onClick={go}>go</button>';

for (const [name, declaration] of [
  ['an arrow', 'const run = () => 1;'],
  ['a function declaration', 'function run() {}'],
] as const) {
  behaves(`function values: ${name} with a data field`, {
    source: `
      ${declaration}
      run.calls = 0;
      export function App() {
        const go = () => { run.calls++; };
        return <main><p>{run.calls}</p>${button}</main>;
      }
    `,
    steps: [{ click: '#go' }, { click: '#go' }],
    check: paragraph(['0', '1', '2']),
  });

  behaves(`function values: a value derived from a field of ${name}`, {
    source: `
      ${declaration}
      run.calls = 1;
      export function App() {
        const doubled = run.calls * 2;
        const go = () => { run.calls++; };
        return <main><p>{doubled}</p>${button}</main>;
      }
    `,
    steps: [{ click: '#go' }, { click: '#go' }],
    check: paragraph(['2', '4', '6']),
  });
}

behaves('function values: a function declared in a component, with a data field', {
  source: `
    export function App() {
      function run() {}
      run.calls = 0;
      const go = () => { run.calls++; };
      return <main><p>{run.calls}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
  check: paragraph(['0', '1']),
});

behaves('function values: a binding given a different function', {
  source: `
    export function App() {
      let count = 1;
      let format = (n) => 'a' + n;
      const go = () => { format = (n) => 'b' + n; };
      return <main><p>{format(count)}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
  check: paragraph(['a1', 'b1']),
});

behaves('function values: a module binding given a different function', {
  source: `
    let format = (n) => 'a' + n;
    export function App() {
      const go = () => { format = (n) => 'b' + n; };
      return <main><p>{format(1)}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
  check: paragraph(['a1', 'b1']),
});

behaves('function values: an object holding a function with a field', {
  source: `
    const run = () => 1;
    run.calls = 0;
    export function App() {
      const holder = { run, label: '' };
      const go = () => { holder.run.calls++; holder.label = 'x'; };
      return <main><p>{holder.run.calls}:{holder.label}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
  check: paragraph(['0:', '1:x', '2:x']),
});

behaves('module builders: a statement that reads a value builds what it writes', {
  source: `
    let factor = 2;
    let total = 0;
    if (factor > 1) total = factor * 10;
    export function App() {
      const go = () => { factor++; };
      return <main><p>{total}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
  check: paragraph(['20', '30']),
});

behaves('module builders: a callback run by the statement is part of it', {
  source: `
    let factor = 2;
    let list = [];
    [1, 2].forEach((value) => { list.push(value * factor); });
    export function App() {
      const go = () => { factor++; };
      return <main><p>{list.join(',')}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
  check: paragraph(['2,4', '3,6']),
});

behaves('module builders: a later write takes the value over', {
  source: `
    let factor = 2;
    let total = 0;
    if (factor > 1) total = factor * 10;
    export function App() {
      const set = () => { total = 7; };
      const go = () => { factor++; };
      return <main><p>{total}</p><button id="set" onClick={set}>set</button>${button}</main>;
    }
  `,
  steps: [{ click: '#set' }, { click: '#go' }],
  check: paragraph(['20', '7', '7']),
});

behaves('module builders: a timer registered at module level runs later, and builds nothing', {
  source: `
    let factor = 2;
    let total = 0;
    setTimeout(() => { total = factor; }, 10);
    export function App() {
      const go = () => { factor++; };
      return <main><p>{total}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { advance: 20 }, { click: '#go' }],
  check: paragraph(['0', '0', '3', '3']),
});

behaves('module builders: a module pattern with a name written later', {
  source: `
    let box = { a: 1, b: 2 };
    let { a, b } = box;
    export function App() {
      const go = () => { a = 9; box = { a: 3, b: 4 }; };
      return <main><p>{a}:{b}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
  check: paragraph(['1:2', '9:4']),
});
