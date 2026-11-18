/** Source-graph oracle for the separate package contract; artifact runs must match it. */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';
import { requestedUrls } from '../harness/requests';

behaves('package contract: forwarded status helpers remain available through loading and refresh', {
  modules: {
    './package/status.ts': `
      import { $track } from '@memoized-dom/data';
      export function status(value) {
        const request = $track(value);
        return request.pending || request.refreshing ? 'waiting' : 'ready';
      }
    `,
    './package/index.ts': `
      import { status } from './status';
      export function label(value) { return status(value); }
    `,
  },
  source: `
    import { label } from './package/index';
    export function App() {
      const user = $fetch('/package/user');
      const request = $track(user);
      const shown = label(user);
      return <main><p>{shown}</p><button onClick={() => request.refresh()}>refresh</button></main>;
    }
  `,
  steps: [
    { respond: '/package/user', value: { name: 'Ada' } },
    { click: 'button' },
    { respond: '/package/user', value: { name: 'Lin' } },
  ],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['waiting', 'ready', 'waiting', 'ready'][observation]);
    expect(requestedUrls()).toEqual(observation < 2 ? ['/package/user'] : ['/package/user', '/package/user']);
  },
});

behaves('package contract: a helper reading both status and payload waits through a forwarding barrel', {
  modules: {
    './package/summary.ts': `
      import { $track } from '@memoized-dom/data';
      export function summary(value) { return $track(value).status + ':' + value.name.toUpperCase(); }
    `,
    './package/index.ts': `
      import { summary } from './summary';
      export function label(value) { return summary(value); }
    `,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { label } from './package/index';
    export function App() {
      const user = $fetch('/package/summary');
      const shown = label(user);
      return <Group pending={() => <i>loading</i>}><p>{shown}</p></Group>;
    }
  `,
  steps: [{ respond: '/package/summary', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'success:ADA'][observation]);
    expect(requestedUrls()).toEqual(['/package/summary']);
  },
});

behaves('package contract: a returned source preserves status and payload across helper forwarding', {
  modules: {
    './package/user.ts': `
      import { $fetch } from '@memoized-dom/data';
      export function userFor(id) { return $fetch('/package/users/' + id, { cache: false }); }
    `,
    './package/index.ts': `
      import { userFor } from './user';
      export function load(id) { return userFor(id); }
    `,
  },
  source: `
    import { load } from './package/index';
    export function App() {
      let id = 1;
      const user = load(id);
      const request = $track(user);
      return <main><p>{request.pending ? 'pending' : request.refreshing ? 'refreshing' : 'ready'}</p><b>{user.name}</b>
        <button onClick={() => id++}>next</button></main>;
    }
  `,
  steps: [
    { respond: '/package/users/1', value: { name: 'Ada' } },
    { click: 'button' },
    { respond: '/package/users/2', value: { name: 'Lin' } },
  ],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['pending', 'ready', 'refreshing', 'ready'][observation]);
    expect(container.querySelector('b')?.textContent).toBe(['', 'Ada', 'Ada', 'Lin'][observation]);
    expect(requestedUrls()).toEqual(observation < 2
      ? ['/package/users/1']
      : ['/package/users/1', '/package/users/2']);
  },
});

behaves('package contract: a helper\'s value follows the status of the source beside it', {
  modules: {
    './package/user.ts': `
      import { $fetch, $track } from '@memoized-dom/data';
      export function userFor(id) {
        const user = $fetch('/package/named/' + id, { cache: false });
        const waiting = $track(user).pending;
        return { waiting: () => waiting };
      }
    `,
  },
  source: `
    import { userFor } from './package/user';
    export function App() {
      const user = userFor(1);
      return <main><p>{String(user.waiting())}</p></main>;
    }
  `,
  steps: [{ respond: '/package/named/1', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['true', 'false'][observation]);
    expect(requestedUrls()).toEqual(['/package/named/1']);
  },
});

behaves('package contract: a helper\'s value follows a write the compiler can see, in any scope', {
  modules: {
    './package/counter.ts': `
      let outside = 1;
      export function bumpOutside() { outside++; }
      export function create(start, options) {
        let count = start;
        const twice = count * 2;
        const fixedOutside = outside;
        const fixedOption = options.value;
        return {
          inc() { count++; },
          edit() { options.value++; },
          read: () => twice + ':' + fixedOutside + ':' + fixedOption,
          live: () => count + ':' + outside + ':' + options.value,
        };
      }
    `,
  },
  source: `
    import { create, bumpOutside } from './package/counter';
    const counter = create(1, { value: 5 });
    export function App() {
      return <main><p>{counter.read()}|{counter.live()}</p>
        <button id="inc" onClick={() => counter.inc()}>inc</button>
        <button id="edit" onClick={() => counter.edit()}>edit</button>
        <button id="outside" onClick={bumpOutside}>outside</button></main>;
    }
  `,
  steps: [{ click: '#inc' }, { click: '#edit' }, { click: '#outside' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe([
      '2:1:5|1:1:5',
      '4:1:5|2:1:5',
      '4:1:6|2:1:6',
      '4:2:6|2:2:6',
    ][observation]);
  },
});

behaves('package contract: a factory\'s parameters are state once a later call changes them', {
  modules: {
    './package/store.ts': `
      export function make(start, options, { nested }, ...rest) {
        return {
          set(value) { start = value; },
          edit() { options.value++; },
          push() { options.list.push(1); },
          deep() { nested.n++; },
          extra() { rest.push(9); },
          show: () => start + ':' + options.value + ':' + options.list.length + ':' + nested.n + ':' + rest.length,
        };
      }
    `,
  },
  source: `
    import { make } from './package/store';
    const first = make(1, { value: 5, list: [] }, { nested: { n: 0 } });
    const second = make(10, { value: 50, list: [] }, { nested: { n: 7 } }, 'a');
    export function App() {
      return <main><p>{first.show()}|{second.show()}</p>
        <button id="set" onClick={() => first.set(2)}>set</button>
        <button id="edit" onClick={() => first.edit()}>edit</button>
        <button id="push" onClick={() => first.push()}>push</button>
        <button id="deep" onClick={() => second.deep()}>deep</button>
        <button id="extra" onClick={() => second.extra()}>extra</button></main>;
    }
  `,
  steps: [{ click: '#set' }, { click: '#edit' }, { click: '#push' }, { click: '#deep' }, { click: '#extra' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe([
      '1:5:0:0:0|10:50:0:7:1',
      '2:5:0:0:0|10:50:0:7:1',
      '2:6:0:0:0|10:50:0:7:1',
      '2:6:1:0:0|10:50:0:7:1',
      '2:6:1:0:0|10:50:0:8:1',
      '2:6:1:0:0|10:50:0:8:2',
    ][observation]);
  },
});

behaves('package contract: a Group passes through a component that uses no sources', {
  modules: {
    './package/Layout.tsx': `
      import { Inner } from './Inner';
      export function Layout({ title, children }) {
        return <section><h1>{title}</h1><Inner>{children}</Inner></section>;
      }
    `,
    './package/Inner.tsx': `export function Inner({ children }) { return <div>{children}</div>; }`,
    './Reader.tsx': `export function Reader() { const user = $fetch('/package/reader'); return <b>{user.name}</b>; }`,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { Layout } from './package/Layout';
    import { Reader } from './Reader';
    export function App() {
      return <Group pending={() => <i>loading</i>}><Layout title="t"><Reader /></Layout></Group>;
    }
  `,
  steps: [{ respond: '/package/reader', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('b')?.textContent ?? container.querySelector('i')?.textContent).toBe(['loading', 'Ada'][observation]);
    expect(requestedUrls()).toEqual(['/package/reader']);
  },
});

behaves('package contract: a component that uses no sources shows a child that does', {
  modules: {
    './package/Frame.tsx': `
      import { Reader } from '../Reader';
      export function Frame() { return <section><Reader /></section>; }
    `,
    './Reader.tsx': `export function Reader() { const user = $fetch('/package/framed'); return <b>{user.name}</b>; }`,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { Frame } from './package/Frame';
    export function App() {
      return <Group pending={() => <i>loading</i>}><Frame /></Group>;
    }
  `,
  steps: [{ respond: '/package/framed', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('b')?.textContent ?? container.querySelector('i')?.textContent).toBe(['loading', 'Ada'][observation]);
  },
});

behaves('package contract: a source given to a component that does nothing else with it still waits', {
  modules: {
    './package/Name.tsx': `export function Name({ user }) { return <b>{user.name}</b>; }`,
    './package/Plain.tsx': `export function Plain({ text }) { return <em>{text}</em>; }`,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { Name } from './package/Name';
    import { Plain } from './package/Plain';
    export function App() {
      const user = $fetch('/package/named-prop');
      return <main><Plain text="always" /><Group pending={() => <i>loading</i>}><Name user={user} /></Group></main>;
    }
  `,
  steps: [{ respond: '/package/named-prop', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('em')?.textContent).toBe('always');
    expect(container.querySelector('b')?.textContent ?? container.querySelector('i')?.textContent).toBe(['loading', 'Ada'][observation]);
  },
});

// The proof must not take `mount` for unknown code that might run a component and wait.
behaves('a component behaves the same when another file mounts it', {
  modules: {
    './start.ts': `
      import { mount } from '@memoized-dom/runtime/testing';
      import { App } from './App';
      export function start(host) { return mount(host, App); }
    `,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    function Reader() {
      const user = $fetch('/package/mounted');
      const label = String(user.name.length);
      return <b>{user.name}:{label}:{String(1 + 1)}</b>;
    }
    export function App() {
      return <main><Group pending={() => <i>loading</i>}><Reader /></Group></main>;
    }
  `,
  steps: [{ respond: '/package/mounted', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('b')?.textContent).toBe(['loading:loading:2', 'Ada:3:2'][observation]);
    expect(requestedUrls()).toEqual(['/package/mounted']);
  },
});

behaves('a component behaves the same when its own file mounts it', {
  source: `
    import { mount } from '@memoized-dom/runtime/testing';
    export function App() {
      const user = $fetch('/package/self-mounted');
      const label = String(1 + 1);
      return <main><p>{user?.name}</p><b>{label}</b></main>;
    }
    export function start(host) { return mount(host, App); }
  `,
  steps: [{ respond: '/package/self-mounted', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['', 'Ada'][observation]);
    expect(container.querySelector('b')?.textContent).toBe('2');
    expect(requestedUrls()).toEqual(['/package/self-mounted']);
  },
});

behaves('package contract: public reexports share package state while components retain separate local state', {
  modules: {
    './package/store.ts': `
      export let count = 1;
      export const identity = {};
      export function increment() { count++; }
    `,
    './package/Counter.tsx': `
      import { count } from './store';
      export function Counter({ label }) {
        let local = 0;
        return <button data-label={label} onClick={() => local++}>{label}:{count}:{local}</button>;
      }
    `,
    './package/index.ts': `export * from './store'; export { Counter } from './Counter';`,
    './package/alias.ts': `export * from './index';`,
  },
  source: `
    import { Counter, count, increment, identity } from './package/index';
    import { identity as alias } from './package/alias';
    export function App() {
      return <main><p>{count}:{String(identity === alias)}</p>
        <Counter label="first"/><Counter label="second"/>
        <button id="shared" onClick={increment}>shared</button></main>;
    }
  `,
  steps: [{ click: '[data-label="first"]' }, { click: '#shared' }, { click: '[data-label="second"]' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:true', '1:true', '2:true', '2:true'][observation]);
    expect(container.querySelector('[data-label="first"]')?.textContent).toBe(['first:1:0', 'first:1:1', 'first:2:1', 'first:2:1'][observation]);
    expect(container.querySelector('[data-label="second"]')?.textContent).toBe(['second:1:0', 'second:1:0', 'second:2:0', 'second:2:1'][observation]);
  },
});
