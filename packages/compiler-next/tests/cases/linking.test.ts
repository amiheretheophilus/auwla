/** Phase 9: native module identities, live exports and readiness (linking.md). */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';
import { requestedUrls } from '../harness/requests';
import * as nativeModule from '../harness/case';

const counter = `
  export let count = 1;
  export const twice = count * 2;
  export function increment() { count++; }
`;

function paragraph(values: readonly string[]) {
  return (container: HTMLElement, observation: number): void => {
    expect(container.querySelector('p')?.textContent).toBe(values[observation]);
  };
}

behaves('linking: star and renamed re-exports share live state and derivations', {
  modules: {
    './store.ts': counter,
    './public/index.ts': `
      export * from '../store';
      export { count as amount, twice as doubled } from '../store';
    `,
  },
  source: `
    import { amount, doubled, increment } from './public';
    export function App() {
      return <main><p>{amount}:{doubled}</p>
        <button onClick={increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check: paragraph(['1:2', '2:4', '3:6']),
});

behaves('linking: a default binding re-export stays live', {
  modules: {
    './store.ts': `${counter} export { count as default };`,
    './bridge.ts': `export { default, increment } from './store';`,
  },
  source: `
    import amount, { increment } from './bridge';
    export function App() {
      return <main><p>{amount}</p><button onClick={increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check: paragraph(['1', '2', '3']),
});

behaves('linking: a default export expression preserves its captured native value', {
  modules: {
    './store.ts': `${counter} export default count;`,
  },
  source: `
    import initial, { count, increment } from './store';
    export function App() {
      return <main><p>{initial}:{count}</p>
        <button onClick={increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check: paragraph(['1:1', '1:2', '1:3']),
});

behaves('linking: namespace members observe the defining module state', {
  modules: { './store.ts': counter },
  source: `
    import * as store from './store';
    export function App() {
      return <main><p>{store.count}:{store.twice}</p>
        <button onClick={store.increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check: paragraph(['1:2', '2:4', '3:6']),
});

behaves('linking: computed namespace members follow the selected live export', {
  modules: { './store.ts': counter },
  source: `
    import * as store from './store';
    export function App() {
      let name = 'count';
      return <main><p>{store[name]}</p>
        <button id="increment" onClick={store.increment}>increment</button>
        <button id="select" onClick={() => name = name === 'count' ? 'twice' : 'count'}>select</button>
      </main>;
    }
  `,
  steps: [
    { click: '#increment' }, { click: '#select' },
    { click: '#increment' }, { click: '#select' },
  ],
  check: paragraph(['1', '2', '4', '6', '3']),
});

behaves('linking: a re-exported namespace keeps live member reads', {
  modules: {
    './store.ts': counter,
    './bridge.ts': `export * as store from './store';`,
  },
  source: `
    import { store } from './bridge';
    export function App() {
      return <main><p>{store.count}:{store.twice}</p>
        <button onClick={store.increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:2', '2:4']),
});

behaves('linking: default components forwarded by a barrel retain child state', {
  modules: {
    './Counter.tsx': `
      export default function Counter({ value }) {
        let local = 0;
        return <section><b>{value}:{local}</b>
          <button id="child" onClick={() => local++}>child</button></section>;
      }
    `,
    './public.ts': `export { default as Counter } from './Counter';`,
  },
  source: `
    import { Counter } from './public';
    export function App() {
      let value = 1;
      return <main><button id="parent" onClick={() => value++}>parent</button>
        <Counter value={value}/></main>;
    }
  `,
  steps: [{ click: '#child' }, { click: '#parent' }, { click: '#child' }],
  check(container, observation) {
    expect(container.querySelector('b')?.textContent).toBe(['1:0', '1:1', '2:1', '2:2'][observation]);
  },
});

behaves('linking: diamond imports preserve one state owner and exported object identity', {
  modules: {
    './store.ts': `${counter} export const identity = {};`,
    './left.ts': `export { count, identity, increment } from './store';`,
    './right.ts': `export { count, identity } from './store';`,
  },
  source: `
    import { count as left, identity as first, increment } from './left';
    import { count as right, identity as second } from './right';
    export function App() {
      return <main><p>{String(first === second)}:{left}:{right}</p>
        <button onClick={increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['true:1:1', 'true:2:2']),
});

behaves('linking: a cycle invokes initialized live exports without duplicating owners', {
  modules: {
    './first.ts': `
      import { incrementSecond } from './second';
      export let first = 1;
      export function readFirst() { return first; }
      export function incrementBoth() { first++; incrementSecond(); }
    `,
    './second.ts': `
      import { readFirst } from './first';
      export let second = 10;
      export function incrementSecond() { second++; }
      export function readBoth() { return readFirst() + ':' + second; }
    `,
  },
  source: `
    import { incrementBoth } from './first';
    import { readBoth } from './second';
    export function App() {
      const shown = readBoth();
      return <main><p>{shown}</p><button onClick={incrementBoth}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check: paragraph(['1:10', '2:11', '3:12']),
});

behaves('linking: module namespaces expose only authored exports and preserve identity', {
  modules: {
    './store.ts': counter,
    './bridge.ts': `export * as store from './store';`,
  },
  source: `
    import * as direct from './store';
    import { store as forwarded } from './bridge';
    export function App() {
      return <main><p>{Object.keys(direct).sort().join(',')}:{String(direct === forwarded)}</p></main>;
    }
  `,
  check: paragraph(['count,increment,twice:true']),
});

behaves('linking: an imported namespace is the receiver of its authored method call', {
  modules: {
    './store.ts': `
      export let count = 1;
      export function read() { return this.count; }
      export function increment() { count++; }
    `,
  },
  source: `
    import * as store from './store';
    export function App() {
      const shown = store.read();
      return <main><p>{shown}</p><button onClick={store.increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1', '2']),
});

behaves('linking: source readiness crosses a helper barrel without duplicate requests', {
  modules: {
    './package/session.ts': `export const user = $fetch('/session');`,
    './package/read.ts': `
      import { user } from './session';
      export function userName() { return user.name.toUpperCase(); }
    `,
    './package/index.ts': `export { userName as title } from './read';`,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { title } from './package';
    export function App() {
      return <Group pending={() => <i>loading</i>}><p>{title()}</p></Group>;
    }
  `,
  steps: [{ respond: '/session', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'ADA'][observation]);
    expect(requestedUrls()).toEqual(['/session']);
  },
});

behaves('linking: a captured default stays captured through named and star forwarding', {
  modules: {
    './store.ts': `${counter} export default count;`,
    './bridge.ts': `export { default as initial, count, increment } from './store';`,
    './public.ts': `
      import { initial } from './bridge';
      export { initial as original };
      export * from './bridge';
    `,
  },
  source: `
    import { initial, original, count, increment } from './public';
    export function App() {
      return <main><p>{initial}:{original}:{count}</p>
        <button onClick={increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:1:1', '1:1:2']),
});

behaves('linking: namespaces retain native shape and expression defaults without type exports', {
  modules: {
    './store.ts': `${counter}
      export default 42;
      export type Hidden = { value: number };
    `,
  },
  source: `
    import * as store from './store';
    export function App() {
      const descriptor = Object.getOwnPropertyDescriptor(store, 'count');
      return <main><p>{Object.keys(store).sort().join(',')}:{store.default}:
        {String(Object.getPrototypeOf(store) === null)}:{String(Object.isSealed(store))}:
        {store[Symbol.toStringTag]}:{String(descriptor.writable)}:{String(descriptor.configurable)}</p></main>;
    }
  `,
  check: paragraph([
    `count,default,increment,twice:42:${Object.getPrototypeOf(nativeModule) === null}:true:Module:true:false`,
  ]),
});

behaves('linking: namespace component tags keep native arguments and retained local state', {
  modules: {
    './views.tsx': `
      export let value = 1;
      export function increment() { value++; }
      export function Counter({ amount }) {
        let local = 0;
        return <section><b>{amount}:{local}</b>
          <button id="child" onClick={() => local++}>child</button></section>;
      }
    `,
  },
  source: `
    import * as views from './views';
    export function App() {
      return <main><button id="parent" onClick={views.increment}>parent</button>
        <views.Counter amount={views.value}/></main>;
    }
  `,
  steps: [{ click: '#child' }, { click: '#parent' }],
  check(container, observation) {
    expect(container.querySelector('b')?.textContent).toBe(['1:0', '1:1', '2:1'][observation]);
  },
});

behaves('linking: cyclic namespace calls can invoke a hoisted function before other exports initialize', {
  modules: {
    './first.ts': `
      import { seed } from './second';
      export let count = seed;
      export function initial() { return 7; }
      export function increment() { count++; }
    `,
    './second.ts': `
      import * as first from './first';
      export const seed = first.initial();
    `,
  },
  source: `
    import { count, increment } from './first';
    export function App() {
      return <main><p>{count}</p><button onClick={increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['7', '8']),
});

behaves('linking: authored paths and helper-like export names never collide with private metadata', {
  modules: {
    './store.ts': `${counter}
      export const _read_count = 11;
      export const _observe_count = 12;
    `,
    './store.mmd.ts': 'export const marker = 8;',
  },
  source: `
    import * as store from './store';
    import { marker } from './store.mmd';
    export function App() {
      return <main><p>{store.count}:{store._read_count}:{store._observe_count}:{marker}</p>
        <button onClick={store.increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:11:12:8', '2:11:12:8']),
});

behaves('linking: ambiguous star exports are absent while explicit exports resolve the conflict', {
  modules: {
    './first.ts': 'export let shared = 1; export function increment() { shared++; }',
    './second.ts': 'export const shared = 2;',
    './ambiguous.ts': `export * from './first'; export * from './second';`,
    './explicit.ts': `
      export * from './first'; export * from './second';
      export { shared } from './first';
    `,
  },
  source: `
    import * as ambiguous from './ambiguous';
    import * as explicit from './explicit';
    export function App() {
      return <main><p>{Object.keys(ambiguous).join(',')}:{explicit.shared}</p>
        <button onClick={explicit.increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['increment:1', 'increment:2']),
});

behaves('linking: anonymous default values forwarded by named and star exports remain public', {
  modules: {
    './store.ts': `${counter} export default 42;`,
    './named.ts': `export { default as fixed } from './store';`,
    './bridge.ts': `export * from './named';`,
  },
  source: `
    import * as store from './store';
    import * as bridge from './bridge';
    export function App() {
      return <main><p>{store.count}:{bridge.fixed}:{Object.keys(bridge).join(',')}</p>
        <button onClick={store.increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:42:fixed', '2:42:fixed']),
});

behaves('linking: star-forwarded public names remain authored imports when metadata uses similar names', {
  modules: {
    './values.ts': 'export const _read_count = 11; export const _observe_count = 12;',
    './store.ts': `${counter} export * from './values';`,
  },
  source: `
    import * as store from './store';
    import { _read_count as authored } from './store';
    export function App() {
      return <main><p>{store.count}:{store._read_count}:{store._observe_count}:{authored}</p>
        <button onClick={store.increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:11:12:11', '2:11:12:11']),
});

behaves('linking: transitive external star exports retain the native namespace surface', {
  modules: {
    './native.ts': `export * from 'node:path';`,
    './store.ts': `${counter} export * from './native';`,
  },
  source: `
    import * as store from './store';
    export function App() {
      return <main><p>{typeof store.dirname}:{store.count}</p>
        <button onClick={store.increment}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['function:1', 'function:2']),
});

behaves('linking: a captured default function remains an ordinary component value', {
  modules: {
    './Label.tsx': `
      function Label(value) { return <b>{value}</b>; }
      export default Label;
    `,
  },
  source: `
    import Label from './Label';
    export function App() {
      let value = 1;
      const shown = Label(value);
      return <main><p>{shown}</p><button onClick={() => value++}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1', '2']),
});

behaves('linking: a captured default object shares mutations but does not follow replacement', {
  modules: {
    './store.ts': `
      export let current = { value: 1 };
      export default current;
      export function mutate() { current.value++; }
      export function replace() { current = { value: 9 }; }
    `,
  },
  source: `
    import initial, { current, mutate, replace } from './store';
    export function App() {
      return <main><p>{initial.value}:{current.value}:{String(initial === current)}</p>
        <button id="mutate" onClick={mutate}>mutate</button>
        <button id="replace" onClick={replace}>replace</button></main>;
    }
  `,
  steps: [{ click: '#mutate' }, { click: '#replace' }, { click: '#mutate' }],
  check: paragraph(['1:1:true', '2:2:true', '2:9:false', '2:10:false']),
});

behaves('linking: a captured object remains writable through its import after the source is replaced', {
  modules: {
    './store.ts': `
      export let current = { value: 1 };
      export default current;
      export function replace() { current = { value: 9 }; }
    `,
  },
  source: `
    import initial, { current, replace } from './store';
    export function App() {
      return <main><p>{initial.value}:{current.value}</p>
        <button id="replace" onClick={replace}>replace</button>
        <button id="mutate" onClick={() => initial.value++}>mutate initial</button></main>;
    }
  `,
  steps: [{ click: '#replace' }, { click: '#mutate' }],
  check: paragraph(['1:1', '1:9', '2:9']),
});

behaves('linking: a namespace can observe a captured object through a helper with no local state', {
  modules: {
    './store.ts': `
      export let current = { value: 1 };
      export default current;
      export function mutate() { current.value++; }
    `,
    './read.ts': `
      import * as store from './store';
      export function read() { return store.default.value; }
    `,
  },
  source: `
    import { mutate } from './store';
    import { read } from './read';
    export function App() {
      const shown = read();
      return <main><p>{shown}</p><button onClick={mutate}>mutate</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1', '2']),
});

behaves('linking: captured anonymous functions keep their native default name', {
  modules: { './double.ts': 'export default value => value * 2;' },
  source: `
    import double from './double';
    export function App() {
      let value = 3;
      const shown = double(value);
      return <main><p>{double.name}:{shown}</p><button onClick={() => value++}>increment</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['default:6', 'default:8']),
});

// Module-level groups of every file are planned as one list (found in css-what, gsap).
behaves('linking: a module derived value reads one from another file with more of them', {
  modules: {
    './values.ts': `
      let n = 1;
      let m = 1;
      export const x = n + 1;
      export const y = m + 1;
      export const z = n + m;
      export function inc() { n++; }
    `,
    './use.ts': `
      import { z } from './values';
      export const w = z * 2;
    `,
  },
  source: `
    import { x, y, inc } from './values';
    import { w } from './use';
    export function App() {
      return <main><p>{x}:{y}:{w}</p><button onClick={inc}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['2:2:4', '3:2:6']),
});

behaves('linking: a module derived value depends on its own group, whatever came before it', {
  modules: {
    './first.ts': `
      let a = 1;
      export const fromFirst = a + 1;
      export function bump() { a++; }
    `,
    './second.ts': `
      import { fromFirst } from './first';
      let b = 1;
      export const own = b * 10;
      export const mixed = own + fromFirst;
      export function grow() { b++; }
    `,
  },
  source: `
    import { bump } from './first';
    import { mixed, grow } from './second';
    export function App() {
      return <main><p>{mixed}</p>
        <button id="bump" onClick={bump}>bump</button>
        <button id="grow" onClick={grow}>grow</button></main>;
    }
  `,
  steps: [{ click: '#bump' }, { click: '#grow' }],
  check: paragraph(['12', '13', '23']),
});

behaves('linking: opaque namespace mutations observe captured and current objects after replacement', {
  modules: {
    './store.ts': `
      export let current = { value: 1 };
      export default current;
      export const snapshot = { value: 0 };
      export function replace() { current = { value: 9 }; }
    `,
  },
  source: `
    import * as store from './store';
    const edit = new Function('store', 'local',
      'store.default.value++; store.current.value++; store.snapshot.value++; local.value++;');
    export function App() {
      const local = { value: 0 };
      return <main><p>{store.default.value}:{store.current.value}:{store.snapshot.value}:{local.value}</p>
        <button id="replace" onClick={store.replace}>replace</button>
        <button id="edit" onClick={() => edit(store, local)}>edit</button></main>;
    }
  `,
  steps: [{ click: '#replace' }, { click: '#edit' }],
  check: paragraph(['1:1:0:0', '1:9:0:0', '2:10:1:1']),
});

// A file of helpers has no component of its own, and is still part of the graph.
behaves('a file holding only helpers reads imported state', {
  modules: {
    './store.ts': `export let count = 1; export function increment() { count++; }`,
    './barrel.ts': `export { count as forwarded } from './store';`,
    // Only function declarations: a `const` here would give the file state of its own.
    './helpers.ts': `
      import { count } from './store';
      import { forwarded } from './barrel';
      export function direct() { return count; }
      export function through() { return forwarded; }
    `,
    './arrows.ts': `
      import { count as renamed } from './store';
      export const arrow = () => renamed;
    `,
    './more.ts': `
      import { direct } from './helpers';
      export function chained() { return direct() * 10; }
    `,
  },
  source: `
    import { increment } from './store';
    import { direct, through } from './helpers';
    import { arrow } from './arrows';
    import { chained } from './more';
    export function App() {
      return <main><p>{direct()}:{arrow()}:{through()}:{chained()}</p><button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check: paragraph(['1:1:1:10', '2:2:2:20', '3:3:3:30']),
});

behaves('a file holding only helpers edits imported state', {
  modules: {
    './store.ts': `
      export const list = [];
      export const settings = { size: 1 };
      export let current = { n: 1 };
      export function replace() { current = { n: current.n + 10 }; }
    `,
    './helpers.ts': `
      import { list, settings, current } from './store';
      export function add(value) { list.push(value); }
      export function grow() { settings.size++; }
      export function bump() { current.n++; }
      export function total() { return list.length + settings.size + current.n; }
    `,
  },
  source: `
    import { list, settings, current, replace } from './store';
    import { add, grow, bump, total } from './helpers';
    export function App() {
      return <main><p>{list.length}:{settings.size}:{current.n}:{total()}</p>
        <button id="add" onClick={() => add(1)}>add</button>
        <button id="grow" onClick={grow}>grow</button>
        <button id="bump" onClick={bump}>bump</button>
        <button id="replace" onClick={replace}>replace</button></main>;
    }
  `,
  steps: [{ click: '#add' }, { click: '#grow' }, { click: '#bump' }, { click: '#replace' }, { click: '#bump' }],
  check: paragraph(['0:1:1:2', '1:1:1:3', '1:2:1:4', '1:2:2:5', '1:2:12:15', '1:2:13:16']),
});

behaves('a helper file read only from a handler, with nothing reading it on the page', {
  modules: {
    './store.ts': `export let count = 1; export function increment() { count++; }`,
    './helpers.ts': `import { count } from './store'; export function direct() { return count; }`,
  },
  source: `
    import { increment } from './store';
    import { direct } from './helpers';
    export function App() {
      let seen = 0;
      return <main><p>{seen}</p>
        <button id="inc" onClick={increment}>inc</button>
        <button id="see" onClick={() => { seen = direct(); }}>see</button></main>;
    }
  `,
  steps: [{ click: '#see' }, { click: '#inc' }, { click: '#see' }],
  check: paragraph(['0', '1', '1', '2']),
});
