/**
 * Phase 9: the shapes of a module graph that a package can take, beyond one import of one
 * name. Dynamic imports, star exports that meet code outside the graph, and cycles
 * (linking.md, "Cases to test").
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';
import { requestedUrls } from '../harness/requests';

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

/** The text of `selector`, or `none` while it is not on the page. */
function shown(selector: string, values: readonly string[]) {
  return (container: HTMLElement, observation: number): void => {
    expect(container.querySelector(selector)?.textContent ?? 'none').toBe(values[observation]!);
  };
}

// ---------------------------------------------------------------------------
// Dynamic imports. Each module here is reached only by `import()` unless a case says so.

behaves('dynamic import: a module nothing imports statically keeps its state live', {
  modules: { './lazy.ts': counter },
  source: `
    export function App() {
      let store = null;
      async function load() { store = await import('./lazy'); }
      return <main>
        <p>{store === null ? 'none' : store.count + ':' + store.twice}</p>
        <button id="load" onClick={load}>load</button>
        {store === null ? null : <button id="inc" onClick={store.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }, { click: '#inc' }],
  check: paragraph(['none', '1:2', '2:4', '3:6']),
});

behaves('dynamic import: the namespace is the static one, and shares its state', {
  modules: { './store.ts': counter },
  source: `
    import * as store from './store';
    import { count } from './store';
    export function App() {
      let same = 'no';
      let lazy = null;
      async function load() {
        lazy = await import('./store');
        same = String(lazy === store);
        lazy.increment();
      }
      return <main>
        <p>{count}:{store.count}:{same}:{lazy === null ? '-' : lazy.count}</p>
        <button id="load" onClick={load}>load</button>
        {lazy === null ? null : <button id="inc" onClick={lazy.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['1:1:no:-', '2:2:true:2', '3:3:true:3']),
});

behaves('dynamic import: destructuring takes the value at that moment', {
  modules: { './store.ts': counter },
  source: `
    import { count, increment } from './store';
    export function App() {
      let seen = 0;
      async function load() {
        const { count: captured } = await import('./store');
        seen = captured;
      }
      return <main>
        <p>{count}:{seen}</p>
        <button id="load" onClick={load}>load</button>
        <button id="inc" onClick={increment}>inc</button>
        {seen === 0 ? null : <i id="ready">ready</i>}
      </main>;
    }
  `,
  steps: [{ click: '#inc' }, { click: '#load', until: '#ready' }, { click: '#inc' }],
  check: paragraph(['1:0', '2:0', '2:2', '3:2']),
});

behaves('dynamic import: then() gets the same namespace', {
  modules: { './lazy.ts': counter },
  source: `
    export function App() {
      let shown = 'none';
      function load() {
        import('./lazy').then((store) => {
          store.increment();
          shown = 'loaded:' + store.count + ':' + store.twice;
        });
      }
      return <main>
        <p>{shown}</p>
        <button id="load" onClick={load}>load</button>
        {shown === 'none' ? null : <i id="ready">ready</i>}
      </main>;
    }
  `,
  // `twice` is derived again before the next render, so a read in the same handler sees the old one.
  steps: [{ click: '#load', until: '#ready' }],
  check: paragraph(['none', 'loaded:2:2']),
});

behaves('dynamic import: a specifier computed at run time keeps the module live', {
  modules: { './lazy.ts': counter },
  source: `
    export function App() {
      let name = 'lazy';
      let store = null;
      async function load() { store = await import('./' + name); }
      return <main>
        <p>{store === null ? 'none' : store.count + ':' + store.twice}</p>
        <button id="load" onClick={load}>load</button>
        {store === null ? null : <button id="inc" onClick={store.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['none', '1:2', '2:4']),
});

behaves('dynamic import: a lazy component keeps its own state across parent updates', {
  modules: {
    './Panel.tsx': `
      export function Panel({ label }) {
        let local = 0;
        return <section><b>{label}:{local}</b>
          <button id="child" onClick={() => local++}>child</button></section>;
      }
    `,
  },
  source: `
    export function App() {
      let Lazy = null;
      let label = 1;
      async function load() { Lazy = (await import('./Panel')).Panel; }
      return <main>
        <button id="load" onClick={load}>load</button>
        <button id="parent" onClick={() => label++}>parent</button>
        {Lazy === null ? <i>none</i> : <Lazy label={label} />}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: 'b' }, { click: '#child' }, { click: '#parent' }, { click: '#child' }],
  check: shown('b', ['none', '1:0', '1:1', '2:1', '2:2']),
});

behaves('dynamic import: a lazy module can hold a source', {
  modules: {
    './session.ts': `
      export const user = $fetch('/lazy/user');
      export function name() { return user.name; }
    `,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    export function App() {
      let session = null;
      async function load() { session = await import('./session'); }
      return <main>
        <button id="load" onClick={load}>load</button>
        {session === null
          ? <p>none</p>
          : <Group pending={() => <p id="waiting">waiting</p>}><p id="named">{session.name()}</p></Group>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#waiting' }, { respond: '/lazy/user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['none', 'waiting', 'Ada'][observation]);
    expect(requestedUrls()).toEqual(observation === 0 ? [] : ['/lazy/user']);
  },
});

behaves('dynamic import: a lazy module\'s own effect and derived values run', {
  modules: {
    './lazy.ts': `
      export let count = 1;
      export const twice = count * 2;
      export let ran = 0;
      $effect(() => { ran = count; });
      export function increment() { count++; }
    `,
  },
  source: `
    export function App() {
      let store = null;
      async function load() { store = await import('./lazy'); }
      return <main>
        <p>{store === null ? 'none' : store.count + ':' + store.twice + ':' + store.ran}</p>
        <button id="load" onClick={load}>load</button>
        {store === null ? null : <button id="inc" onClick={store.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['none', '1:2:1', '2:4:2']),
});

behaves('dynamic import: a lazy page with no exported state has nothing to observe', {
  modules: {
    './Page.tsx': `
      let visits = 0;
      export function Page() {
        return <section><b>{visits}</b><button id="visit" onClick={() => visits++}>visit</button></section>;
      }
    `,
  },
  source: `
    export function App() {
      let Lazy = null;
      async function load() { Lazy = (await import('./Page')).Page; }
      return <main>
        <button id="load" onClick={load}>load</button>
        {Lazy === null ? <i>none</i> : <Lazy />}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: 'b' }, { click: '#visit' }],
  check: shown('b', ['none', '0', '1']),
});

behaves('dynamic import: destructuring on the page follows the state, as a read does', {
  modules: { './store.ts': counter },
  source: `
    export function App() {
      let kit = null;
      async function load() { kit = await import('./store'); }
      return <main>
        <button id="load" onClick={load}>load</button>
        {kit === null ? <p>none</p> : <Shown kit={kit} />}
      </main>;
    }
    function Shown({ kit }) {
      const { count, increment } = kit;
      return <section><p>{count}</p><button id="inc" onClick={increment}>inc</button></section>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['none', '1', '2']),
});

behaves('dynamic import: a helper reads state off a namespace it was handed', {
  modules: {
    './store.ts': counter,
    './read.ts': `export function total(kit) { return kit.count + kit.twice; }`,
  },
  source: `
    import { total } from './read';
    export function App() {
      let kit = null;
      async function load() { kit = await import('./store'); }
      return <main>
        <p>{kit === null ? 'none' : total(kit)}</p>
        <button id="load" onClick={load}>load</button>
        {kit === null ? null : <button id="inc" onClick={kit.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['none', '3', '6']),
});

behaves('dynamic import: optional chains still stop at the first missing value', {
  modules: { './store.ts': counter },
  source: `
    export function App() {
      let kit = null;
      let box = null;
      async function load() { kit = await import('./store'); }
      return <main>
        <p>{String(kit?.count)}:{String(box?.inner.count)}</p>
        <button id="load" onClick={load}>load</button>
        {kit === null ? null : <button id="inc" onClick={kit.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['undefined:undefined', '1:undefined', '2:undefined']),
});

behaves('dynamic import: a namespace further along an optional chain is observed', {
  modules: { './store.ts': counter },
  source: `
    export function App() {
      let box = null;
      async function load() { box = { inner: await import('./store') }; }
      return <main>
        <p>{String(box?.inner.count)}</p>
        <button id="load" onClick={load}>load</button>
        {box === null ? null : <button id="inc" onClick={box.inner.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['undefined', '1', '2']),
});

behaves('dynamic import: a lowered optional chain keeps its receiver, order and errors', {
  modules: { './store.ts': counter },
  source: `
    export function App() {
      let kit = null;
      let calls = 0;
      const shelf = {
        tag: 'shelf',
        name() { return this.tag; },
        missing: null,
        get inner() { calls++; return kit; },
      };
      const empty = null;
      let wentOn = false;
      const skip = () => { wentOn = true; return 1; };
      async function load() { kit = await import('./store'); }
      function thrown() {
        const none = {};
        let text = 'no error';
        try { none?.missing.count; } catch (error) { text = error.name; }
        return text;
      }
      return <main>
        <p>{String(shelf?.inner?.count)}:{shelf.name?.()}:{String(shelf.missing?.())}:{String(empty?.inner.count(skip()))}:{String(wentOn)}:{thrown()}</p>
        <button id="load" onClick={load}>load</button>
        {kit === null ? null : <button id="inc" onClick={kit.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph([
    'undefined:shelf:undefined:undefined:false:TypeError',
    '1:shelf:undefined:undefined:false:TypeError',
    '2:shelf:undefined:undefined:false:TypeError',
  ]),
});

behaves('dynamic import: an optional call in a chain leaves the receiver alone', {
  modules: { './store.ts': counter },
  source: `
    export function App() {
      let kit = null;
      const holder = {
        tag: 'holder',
        current() { return this.tag === 'holder' ? kit : null; },
      };
      async function load() { kit = await import('./store'); }
      return <main>
        <p>{String(holder.current?.()?.count)}:{kit === null ? '-' : holder.current?.().twice}</p>
        <button id="load" onClick={load}>load</button>
        {kit === null ? null : <button id="inc" onClick={kit.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['undefined:-', '1:2', '2:4']),
});

// The rule for property reads covers patterns: a getter can read state the pattern does not name.
behaves('a destructured getter follows what it reads', {
  source: `
    let count = 1;
    const box = { get value() { return count; } };
    function read({ value }) { return value; }
    export function App() {
      const { value } = box;
      const [first] = { *[Symbol.iterator]() { yield count * 10; } };
      let assigned;
      ({ value: assigned } = box);
      return <main><p>{value}:{read(box)}:{first}:{assigned}</p><button onClick={() => count++}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:1:10:1', '2:2:20:2']),
});

behaves('dynamic import: an exported default value is observed like a binding', {
  modules: {
    './store.ts': `
      export let current = { value: 1 };
      export default current;
      export function mutate() { current.value++; }
    `,
  },
  source: `
    export function App() {
      let kit = null;
      async function load() { kit = await import('./store'); }
      return <main>
        <p>{kit === null ? 'none' : kit.default.value + ':' + kit.current.value}</p>
        <button id="load" onClick={load}>load</button>
        {kit === null ? null : <button id="mutate" onClick={kit.mutate}>mutate</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#mutate' }, { click: '#mutate' }],
  check: paragraph(['none', '1:1', '2:2']),
});

behaves('dynamic import: a barrel of star exports is live through its namespace', {
  modules: {
    './store.ts': counter,
    './public.ts': `export * from './store'; export const name = 'public';`,
  },
  source: `
    export function App() {
      let kit = null;
      async function load() { kit = await import('./public'); }
      return <main>
        <p>{kit === null ? 'none' : Object.keys(kit).sort().join(',') + ':' + kit.count}</p>
        <button id="load" onClick={load}>load</button>
        {kit === null ? null : <button id="inc" onClick={kit.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['none', 'count,increment,name,twice:1', 'count,increment,name,twice:2']),
});

behaves('dynamic import: a file of helpers hands out the import', {
  modules: {
    './store.ts': counter,
    './loader.ts': `export function loadStore() { return import('./store'); }`,
  },
  source: `
    import { loadStore } from './loader';
    export function App() {
      let store = null;
      async function load() { store = await loadStore(); }
      return <main>
        <p>{store === null ? 'none' : store.count}</p>
        <button id="load" onClick={load}>load</button>
        {store === null ? null : <button id="inc" onClick={store.increment}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['none', '1', '2']),
});

behaves('dynamic import: two lazy modules that import each other share one state', {
  modules: {
    './first.ts': `
      import { second, bumpSecond } from './second';
      export let first = 1;
      export function bumpBoth() { first++; bumpSecond(); }
      export function both() { return first + ':' + second; }
    `,
    './second.ts': `
      export let second = 10;
      export function bumpSecond() { second++; }
      export async function loadFirst() { return import('./first'); }
    `,
  },
  source: `
    export function App() {
      let first = null;
      async function load() {
        const second = await import('./second');
        first = await second.loadFirst();
      }
      return <main>
        <p>{first === null ? 'none' : first.both()}</p>
        <button id="load" onClick={load}>load</button>
        {first === null ? null : <button id="inc" onClick={first.bumpBoth}>inc</button>}
      </main>;
    }
  `,
  steps: [{ click: '#load', until: '#inc' }, { click: '#inc' }],
  check: paragraph(['none', '1:10', '2:11']),
});

behaves('dynamic import: awaited at the top of a module', {
  modules: {
    './names.ts': `export const label = 'top';`,
    './store.ts': counter,
  },
  source: `
    const { label } = await import('./names');
    const store = await import('./store');
    export function App() {
      return <main><p>{label}:{store.count}</p><button onClick={store.increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['top:1', 'top:2']),
});

// ---------------------------------------------------------------------------
// Star exports.

behaves('star: two modules forwarding each other see each other\'s names', {
  modules: {
    './left.ts': `
      export * from './right';
      export let left = 1;
      export function bumpLeft() { left++; }
    `,
    './right.ts': `
      export * from './left';
      export let right = 10;
      export function bumpRight() { right++; }
    `,
  },
  source: `
    import { left, right, bumpLeft } from './right';
    import { bumpRight } from './left';
    import * as both from './left';
    export function App() {
      return <main><p>{left}:{right}:{Object.keys(both).sort().join(',')}</p>
        <button id="left" onClick={bumpLeft}>left</button>
        <button id="right" onClick={bumpRight}>right</button></main>;
    }
  `,
  steps: [{ click: '#left' }, { click: '#right' }],
  check: paragraph([
    '1:10:bumpLeft,bumpRight,left,right',
    '2:10:bumpLeft,bumpRight,left,right',
    '2:11:bumpLeft,bumpRight,left,right',
  ]),
});

behaves('star: one binding reached by two paths is not ambiguous', {
  modules: {
    './store.ts': counter,
    './left.ts': `export * from './store';`,
    './right.ts': `export { count, increment } from './store';`,
    './public.ts': `export * from './left'; export * from './right';`,
  },
  source: `
    import { count, increment } from './public';
    import * as kit from './public';
    export function App() {
      return <main><p>{count}:{kit.count}:{Object.keys(kit).sort().join(',')}</p>
        <button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:1:count,increment,twice', '2:2:count,increment,twice']),
});

behaves('star: a default is not forwarded, and a local name wins over a forwarded one', {
  modules: {
    './store.ts': `${counter} export const label = 'store'; export default 'hidden';`,
    './public.ts': `export * from './store'; export const label = 'public';`,
  },
  source: `
    import { count, label, increment } from './public';
    import * as kit from './public';
    export function App() {
      return <main><p>{count}:{label}:{String(kit.default)}:{Object.keys(kit).sort().join(',')}</p>
        <button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:public:undefined:count,increment,label,twice', '2:public:undefined:count,increment,label,twice']),
});

// Nothing in the graph can see that `join` also comes from `node:path`. The language removes
// a name that two stars give different bindings for, so the state here must not be linked.
behaves('star: a name also forwarded from outside the graph is absent, not linked', {
  modules: {
    './own.ts': `
      export let join = 1;
      export let kept = 1;
      export function bump() { join++; kept++; }
    `,
    './public.ts': `export * from 'node:path'; export * from './own';`,
  },
  source: `
    import * as kit from './public';
    export function App() {
      return <main><p>{typeof kit.join}:{kit.kept}:{typeof kit.dirname}</p>
        <button onClick={kit.bump}>bump</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['undefined:1:function', 'undefined:2:function']),
});

behaves('star: a local name still wins over one forwarded from outside the graph', {
  modules: {
    './public.ts': `
      export * from 'node:path';
      export let join = 1;
      export function bump() { join++; }
    `,
  },
  source: `
    import { join, bump, dirname } from './public';
    import * as kit from './public';
    export function App() {
      return <main><p>{join}:{kit.join}:{typeof dirname}</p><button onClick={bump}>bump</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:1:function', '2:2:function']),
});

behaves('star: a computed member finds state beside a forwarded outside module', {
  modules: {
    './store.ts': counter,
    './public.ts': `export * from './store'; export * from 'node:path';`,
  },
  source: `
    import * as kit from './public';
    export function App() {
      let name = 'count';
      return <main><p>{typeof kit[name]}:{kit[name]}</p>
        <button id="inc" onClick={kit.increment}>inc</button>
        <button id="pick" onClick={() => name = 'twice'}>pick</button></main>;
    }
  `,
  steps: [{ click: '#inc' }, { click: '#pick' }, { click: '#inc' }],
  check: paragraph(['number:1', 'number:2', 'number:4', 'number:6']),
});

behaves('star: forwards a namespace, a component and a source', {
  modules: {
    './store.ts': counter,
    './session.ts': `export const user = $fetch('/star/user');`,
    './Badge.tsx': `
      export function Badge({ value }) {
        let local = 0;
        return <b onClick={() => local++}>{value}:{local}</b>;
      }
    `,
    './inner.ts': `
      export * as store from './store';
      export * from './session';
      export * from './Badge';
    `,
    './public.ts': `export * from './inner';`,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { store, user, Badge } from './public';
    export function App() {
      return <main>
        <Badge value={store.count} />
        <button onClick={store.increment}>inc</button>
        <Group pending={() => <p>waiting</p>}><p>{user.name}</p></Group>
      </main>;
    }
  `,
  steps: [
    { click: 'b' },
    { click: 'button' },
    { respond: '/star/user', value: { name: 'Ada' } },
  ],
  check(container, observation) {
    expect(container.querySelector('b')?.textContent).toBe(['1:0', '1:1', '2:1', '2:1'][observation]);
    expect(container.querySelector('p')?.textContent).toBe(['waiting', 'waiting', 'waiting', 'Ada'][observation]);
  },
});

behaves('star: forwarding only types leaves nothing at run time', {
  modules: {
    './types.ts': `export type Size = number; export interface Named { name: string }`,
    './store.ts': counter,
    './public.ts': `
      export type * from './types';
      export * from './types';
      export type { Size as Length } from './types';
      export * from './store';
    `,
  },
  source: `
    import { count, increment, type Size } from './public';
    import * as kit from './public';
    export function App() {
      const size: Size = 2;
      return <main><p>{count}:{size}:{Object.keys(kit).sort().join(',')}</p>
        <button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:2:count,increment,twice', '2:2:count,increment,twice']),
});

// ---------------------------------------------------------------------------
// Cycles.

behaves('cycle: three modules write each other\'s state in a chain', {
  modules: {
    './a.ts': `
      import { bumpB } from './b';
      export let a = 1;
      export function bumpA() { a++; bumpB(); }
    `,
    './b.ts': `
      import { bumpC } from './c';
      export let b = 10;
      export function bumpB() { b++; bumpC(); }
    `,
    './c.ts': `
      import { a } from './a';
      export let c = 100;
      export function bumpC() { c += a; }
    `,
  },
  source: `
    import { a, bumpA } from './a';
    import { b } from './b';
    import { c } from './c';
    export function App() {
      return <main><p>{a}:{b}:{c}</p><button onClick={bumpA}>bump</button></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check: paragraph(['1:10:100', '2:11:102', '3:12:105']),
});

// Very common in real packages: a component imports its sibling from the package's own barrel.
behaves('cycle: a component imports its sibling from the barrel that exports it', {
  modules: {
    './kit/index.ts': `
      export { Button } from './Button';
      export { Card } from './Card';
      export { count, increment } from './store';
    `,
    './kit/store.ts': counter,
    './kit/Button.tsx': `
      import { count, increment } from './index';
      export function Button() { return <button onClick={increment}>{count}</button>; }
    `,
    './kit/Card.tsx': `
      import { Button, count } from './index';
      export function Card() { return <section><p>{count}</p><Button /></section>; }
    `,
  },
  source: `
    import { Card } from './kit';
    export function App() { return <main><Card /></main>; }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2', '3'][observation]);
    expect(container.querySelector('button')?.textContent).toBe(['1', '2', '3'][observation]);
  },
});

behaves('cycle: two components in two files render each other', {
  modules: {
    './Even.tsx': `
      import { Odd } from './Odd';
      export function Even({ depth }) {
        let clicks = 0;
        return <div class="even" onClick={(event) => { event.stopPropagation(); clicks++; }}>
          even:{depth}:{clicks}{depth > 0 ? <Odd depth={depth - 1} /> : null}
        </div>;
      }
    `,
    './Odd.tsx': `
      import { Even } from './Even';
      export function Odd({ depth }) {
        return <div class="odd">odd:{depth}{depth > 0 ? <Even depth={depth - 1} /> : null}</div>;
      }
    `,
  },
  source: `
    import { Even } from './Even';
    export function App() {
      let depth = 2;
      return <main><button onClick={() => depth = depth === 2 ? 4 : 2}>depth</button><Even depth={depth} /></main>;
    }
  `,
  steps: [{ click: '.even' }, { click: 'button' }, { click: 'button' }],
});

behaves('cycle: a source passes between two files that call each other', {
  modules: {
    './first.ts': `
      import { $track } from '@memoized-dom/data';
      import { second } from './second';
      export function first(source, depth) {
        return depth === 0 ? $track(source).pending : second(source, depth - 1);
      }
    `,
    './second.ts': `
      import { first } from './first';
      export function second(source, depth) { return first(source, depth); }
    `,
  },
  source: `
    import { first } from './first';
    export function App() {
      const stories = $fetch('/cycle/stories');
      return <main><p>{String(first(stories, 3))}</p></main>;
    }
  `,
  // A function that recurses is not followed: passing the source to it counts as reading its
  // payload, so this waits. The same in one file, and only a cost in what shows while loading.
  steps: [{ respond: '/cycle/stories', value: [] }],
  check: paragraph(['', 'false']),
});

behaves('cycle: a derived value at module level reads state through the other file', {
  modules: {
    './first.ts': `
      import { plusOne } from './second';
      export let value = 1;
      export const next = plusOne();
      export function increment() { value++; }
    `,
    './second.ts': `
      import { value } from './first';
      export function plusOne() { return value + 1; }
    `,
  },
  source: `
    import { value, next, increment } from './first';
    export function App() {
      return <main><p>{value}:{next}</p><button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:2', '2:3']),
});

// The second file runs first and reads a `let` the first has not reached. The language throws,
// and no compiled form may turn that into `undefined`.
behaves('cycle: reading a binding before its file has run still throws', {
  modules: {
    './first.ts': `
      import { early } from './second';
      export let value = 1;
      export { early };
      export function increment() { value++; }
    `,
    './second.ts': `
      import { value } from './first';
      let seen;
      try { seen = value; } catch (error) { seen = error.name; }
      export const early = seen;
    `,
  },
  source: `
    import { value, early, increment } from './first';
    export function App() {
      return <main><p>{value}:{early}</p><button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:ReferenceError', '2:ReferenceError']),
});

behaves('cycle: a module imports itself', {
  modules: {
    './self.ts': `
      import { count as own, increment as bump } from './self';
      import * as self from './self';
      export let count = 1;
      export function increment() { count++; }
      export function twiceBump() { bump(); self.increment(); }
      export function read() { return own + ':' + self.count; }
    `,
  },
  source: `
    import { read, twiceBump } from './self';
    export function App() {
      const shown = read();
      return <main><p>{shown}</p><button onClick={twiceBump}>bump</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['1:1', '3:3']),
});

behaves('cycle: a helper imports state from the app that imports it', {
  modules: {
    './helper.ts': `
      import { total, addTo } from './App';
      export function describe() { return 'total ' + total; }
      export function addTwo() { addTo(2); }
    `,
  },
  source: `
    import { describe, addTwo } from './helper';
    export let total = 1;
    export function addTo(amount) { total += amount; }
    export function App() {
      const shown = describe();
      return <main><p>{shown}</p><button onClick={addTwo}>add</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check: paragraph(['total 1', 'total 3']),
});

behaves('cycle: a child reads and writes state its parent file exports', {
  modules: {
    './Child.tsx': `
      import { shared, bump } from './Parent';
      export function Child() { return <button onClick={bump}>{shared}</button>; }
    `,
    './Parent.tsx': `
      import { Child } from './Child';
      export let shared = 1;
      export function bump() { shared++; }
      export function Parent() { return <section><p>{shared}</p><Child /></section>; }
    `,
  },
  source: `
    import { Parent } from './Parent';
    export function App() { return <main><Parent /></main>; }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
    expect(container.querySelector('button')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('cycle: two files re-export each other\'s state', {
  modules: {
    './left.ts': `
      export { right, bumpRight } from './right';
      export let left = 1;
      export function bumpLeft() { left++; }
    `,
    './right.ts': `
      export { left, bumpLeft } from './left';
      export let right = 10;
      export function bumpRight() { right++; }
    `,
  },
  source: `
    import { right, bumpLeft } from './left';
    import { left, bumpRight } from './right';
    export function App() {
      return <main><p>{left}:{right}</p>
        <button id="left" onClick={bumpLeft}>left</button>
        <button id="right" onClick={bumpRight}>right</button></main>;
    }
  `,
  steps: [{ click: '#left' }, { click: '#right' }],
  check: paragraph(['1:10', '2:10', '2:11']),
});
