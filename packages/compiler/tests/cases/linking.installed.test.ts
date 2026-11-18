/**
 * Native packages as an app meets them: installed under `node_modules`, imported by a bare
 * specifier, and compiled in the app's graph. The files are written as given, so the test
 * runtime resolves each specifier by itself.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';
import { requestedUrls } from '../harness/requests';

const store = (start: number) => `
  export let count = ${start};
  export function increment() { count++; }
`;

behaves('installed: a component and its state through a bare specifier', {
  modules: {
    './node_modules/kit/index.ts': `export { count, increment } from './store'; export { Badge } from './Badge';`,
    './node_modules/kit/store.ts': store(1),
    './node_modules/kit/Badge.tsx': `
      import { count } from './store';
      export function Badge({ label }) {
        let clicks = 0;
        return <button onClick={() => clicks++}>{label}:{count}:{clicks}</button>;
      }
    `,
  },
  source: `
    import { Badge, count, increment } from 'kit';
    export function App() {
      return <main><p>{count}</p><Badge label="a" /><i onClick={increment}>inc</i></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'i' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '1', '2'][observation]);
    expect(container.querySelector('button')?.textContent).toBe(['a:1:0', 'a:1:1', 'a:2:1'][observation]);
  },
});

behaves('installed: a subpath and the barrel name one module, so one state', {
  modules: {
    './node_modules/@acme/kit/index.ts': `export * from './store';`,
    './node_modules/@acme/kit/store.ts': store(1),
    './node_modules/@acme/kit/extra/index.ts': `export { count as extra } from '../store';`,
  },
  source: `
    import { count, increment } from '@acme/kit';
    import { count as direct } from '@acme/kit/store';
    import { extra } from '@acme/kit/extra';
    export function App() {
      return <main><p>{count}:{direct}:{extra}</p><button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:1:1', '2:2:2'][observation]);
  },
});

behaves('installed: two copies of a package in one graph each keep their own state', {
  modules: {
    './node_modules/kit/index.ts': store(1),
    './node_modules/wrapper/index.ts': `
      import { count, increment } from 'kit';
      export function nested() { return count; }
      export { increment as bump };
    `,
    './node_modules/wrapper/node_modules/kit/index.ts': store(100),
  },
  source: `
    import { count, increment } from 'kit';
    import { nested, bump } from 'wrapper';
    export function App() {
      return <main><p>{count}:{nested()}</p>
        <button id="top" onClick={increment}>top</button>
        <button id="nested" onClick={bump}>nested</button></main>;
    }
  `,
  steps: [{ click: '#top' }, { click: '#nested' }, { click: '#nested' }, { click: '#top' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:100', '2:100', '2:101', '2:102', '3:102'][observation]);
  },
});

behaves('installed: two copies with the same exports, both used by the app', {
  modules: {
    './node_modules/kit/index.ts': store(1),
    './node_modules/wrapper/index.ts': `export { count as inner, increment as bump } from 'kit';`,
    './node_modules/wrapper/node_modules/kit/index.ts': store(100),
  },
  source: `
    import { count, increment } from 'kit';
    import { inner, bump } from 'wrapper';
    export function App() {
      return <main><p>{count}:{inner}</p>
        <button id="top" onClick={increment}>top</button>
        <button id="nested" onClick={bump}>nested</button></main>;
    }
  `,
  steps: [{ click: '#top' }, { click: '#nested' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:100', '2:100', '2:101'][observation]);
  },
});

behaves('installed: two packages depending on one hoisted copy share it', {
  modules: {
    './node_modules/dep/index.ts': store(1),
    './node_modules/left/index.ts': `export { count as left } from 'dep';`,
    './node_modules/right/index.ts': `export { count as right, increment } from 'dep';`,
  },
  source: `
    import { left } from 'left';
    import { right, increment } from 'right';
    export function App() {
      return <main><p>{left}:{right}</p><button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:1', '2:2'][observation]);
  },
});

behaves('installed: a namespace of a package stays live and keeps its shape', {
  modules: {
    './node_modules/kit/index.ts': `export * from './store'; export const name = 'kit';`,
    './node_modules/kit/store.ts': store(1),
  },
  source: `
    import * as kit from 'kit';
    export function App() {
      return <main><p>{kit.name}:{kit.count}:{Object.keys(kit).sort().join(',')}</p>
        <button onClick={() => kit.increment()}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['kit:1:count,increment,name', 'kit:2:count,increment,name'][observation]);
  },
});

behaves('installed: a default export and a package that re-exports another', {
  modules: {
    './node_modules/dep/index.tsx': `
      export let total = 1;
      export function add() { total++; }
      export default function Total() { return <b>{total}</b>; }
    `,
    './node_modules/kit/index.ts': `export * from 'dep'; export { default as Total } from 'dep';`,
  },
  source: `
    import { Total, total, add } from 'kit';
    export function App() {
      return <main><p>{total}</p><Total /><button onClick={add}>add</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
    expect(container.querySelector('b')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('installed: a package component as a row of the app\'s list', {
  modules: {
    './node_modules/kit/index.ts': `export { Row } from './Row';`,
    './node_modules/kit/Row.tsx': `
      export function Row({ item, suffix }) {
        let clicks = 0;
        return <li onClick={() => clicks++}>{item.label}{suffix}:{clicks}</li>;
      }
    `,
  },
  source: `
    import { Row } from 'kit';
    export function App() {
      let suffix = '!';
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
      return <main><ul>{rows.map((item) => <Row key={item.id} item={item} suffix={suffix} />)}</ul>
        <button id="suffix" onClick={() => suffix += '!'}>suffix</button>
        <button id="swap" onClick={() => rows = [rows[1], rows[0]]}>swap</button></main>;
    }
  `,
  steps: [{ click: 'li' }, { click: '#suffix' }, { click: '#swap' }],
  check(container, observation) {
    const shown = [...container.querySelectorAll('li')].map((row) => row.textContent).join(',');
    expect(shown).toBe(['a!:0,b!:0', 'a!:1,b!:0', 'a!!:1,b!!:0', 'b!!:0,a!!:1'][observation]!);
  },
});

behaves('installed: a package hands the app a source, and a Group in the app waits for it', {
  modules: {
    './node_modules/kit/index.ts': `export { useUser, Name } from './user';`,
    './node_modules/kit/user.tsx': `
      import { $fetch, $track } from '@memoized-dom/data';
      export function useUser(id) { return $fetch('/installed/user/' + id); }
      export function Name({ user }) {
        const request = $track(user);
        return <b>{request.status}:{user.name}</b>;
      }
    `,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { useUser, Name } from 'kit';
    export function App() {
      const user = useUser(1);
      return <main><Group pending={() => <i>loading</i>}><Name user={user} /></Group></main>;
    }
  `,
  steps: [{ respond: '/installed/user/1', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('b')?.textContent).toBe(['pending:loading', 'success:Ada'][observation]);
    expect(requestedUrls()).toEqual(['/installed/user/1']);
  },
});

behaves('installed: a package loaded by a dynamic import shares state with its static importers', {
  modules: {
    './node_modules/kit/index.ts': store(1),
    './node_modules/kit/lazy.ts': `export { count as lazyCount, increment as lazyIncrement } from './index';`,
  },
  // Already loaded, so `import()` settles within a step however busy the machine is. Bun
  // reading the file from disk can take longer than the harness waits.
  source: `
    import 'kit/lazy';
    import { count } from 'kit';
    export function App() {
      let loaded = 'no';
      async function load() {
        const lazy = await import('kit/lazy');
        lazy.lazyIncrement();
        loaded = 'yes:' + lazy.lazyCount;
      }
      return <main><p>{count}:{loaded}</p><button onClick={load}>load</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:no', '2:yes:2'][observation]);
  },
});

behaves('installed: a package names its TypeScript source with a .js extension', {
  modules: {
    './node_modules/kit/index.ts': `export { count, increment } from './store.js'; export { Badge } from './Badge.js';`,
    './node_modules/kit/store.ts': store(1),
    './node_modules/kit/Badge.tsx': `
      import { count } from './store.js';
      export function Badge() { return <b>{count}</b>; }
    `,
  },
  source: `
    import { Badge, count, increment } from 'kit';
    export function App() {
      return <main><p>{count}</p><Badge /><button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1', '2'][observation]);
    expect(container.querySelector('b')?.textContent).toBe(['1', '2'][observation]);
  },
});

behaves('installed: a native package forwards an ordinary dependency outside the graph', {
  modules: {
    './node_modules/kit/index.ts': `
      export * from './store';
      export * from 'node:path';
      export { sep as separator } from 'node:path';
    `,
    './node_modules/kit/store.ts': store(1),
  },
  source: `
    import { basename, count, increment, separator } from 'kit';
    import * as kit from 'kit';
    export function App() {
      return <main>
        <p>{count}:{kit.count}:{basename('a/b.txt')}:{typeof kit.join}:{typeof separator}</p>
        <button onClick={increment}>inc</button>
      </main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:1:b.txt:function:string', '2:2:b.txt:function:string'][observation]);
  },
});

behaves('installed: two packages import each other', {
  modules: {
    './node_modules/left/index.ts': `
      import { right, bumpRight } from 'right';
      export let left = 1;
      export function bumpLeft() { left++; }
      export function both() { bumpRight(); return left + ':' + right; }
    `,
    './node_modules/right/index.ts': `
      import { left } from 'left';
      export let right = 10;
      export function bumpRight() { right++; }
      export function sum() { return left + right; }
    `,
  },
  source: `
    import { left, bumpLeft, both } from 'left';
    import { right, sum } from 'right';
    export function App() {
      let last = '';
      return <main><p>{left}:{right}:{sum()}:{last}</p>
        <button id="left" onClick={bumpLeft}>left</button>
        <button id="both" onClick={() => { last = both(); }}>both</button></main>;
    }
  `,
  steps: [{ click: '#left' }, { click: '#both' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:10:11:', '2:10:12:', '2:11:13:2:11'][observation]);
  },
});

behaves('installed: a package imports itself by name', {
  modules: {
    './node_modules/kit/index.ts': `export * from './store'; export { shown } from './shown';`,
    './node_modules/kit/store.ts': store(1),
    './node_modules/kit/shown.ts': `
      import { count } from 'kit/store';
      export function shown() { return 'n' + count; }
    `,
  },
  source: `
    import { count, increment, shown } from 'kit';
    export function App() {
      return <main><p>{count}:{shown()}</p><button onClick={increment}>inc</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:n1', '2:n2'][observation]);
  },
});

behaves('installed: components of two copies keep their own state and templates', {
  modules: {
    './node_modules/kit/index.tsx': `
      export let shared = 1;
      export function Badge() {
        let clicks = 0;
        return <button class="top" onClick={() => { clicks++; shared++; }}>top:{clicks}:{shared}</button>;
      }
    `,
    './node_modules/wrapper/index.ts': `export { Badge as Inner } from 'kit';`,
    './node_modules/wrapper/node_modules/kit/index.tsx': `
      export let shared = 100;
      export function Badge() {
        let clicks = 0;
        return <button class="nested" onClick={() => { clicks++; shared++; }}>nested:{clicks}:{shared}</button>;
      }
    `,
  },
  source: `
    import { Badge } from 'kit';
    import { Inner } from 'wrapper';
    export function App() {
      return <main><Badge /><Inner /></main>;
    }
  `,
  steps: [{ click: '.top' }, { click: '.nested' }, { click: '.nested' }],
  check(container, observation) {
    expect(container.querySelector('.top')?.textContent).toBe(['top:0:1', 'top:1:2', 'top:1:2', 'top:1:2'][observation]);
    expect(container.querySelector('.nested')?.textContent).toBe(['nested:0:100', 'nested:0:100', 'nested:1:101', 'nested:2:102'][observation]);
  },
});
