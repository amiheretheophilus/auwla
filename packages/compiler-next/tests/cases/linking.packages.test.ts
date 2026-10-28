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
