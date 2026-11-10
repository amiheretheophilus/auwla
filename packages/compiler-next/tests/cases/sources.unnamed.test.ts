/**
 * A source reached in a way the compiler cannot name: a computed key, a class instance, a `Map`, a
 * call. Each read waits while the source loads, as a named one does (rule 8), where it threw
 * `UnresolvedDataReadError` before. The runtime treats only that error, or the failure of a source
 * it read, as waiting (`wiki/decisions.md`, 2026-11-10, "one runtime catch"; `compiler/sources.md`,
 * "Reads the compiler cannot name").
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

const shown = (container: HTMLElement, observation: number) => {
  expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada'][observation]);
};

behaves('unnamed reads: a computed key waits for the source it reaches', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    export function App() {
      const queries = { user: $fetch('/unnamed/key') };
      let tab = 'user';
      return <Group pending={() => <p>loading</p>}><p>{queries[tab].name}</p></Group>;
    }`,
  steps: [{ respond: '/unnamed/key', value: { name: 'Ada' } }],
  check: shown,
});

behaves('unnamed reads: a field of a class instance waits for its source', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    class Store { constructor() { this.user = $fetch('/unnamed/class'); } }
    export function App() {
      const store = new Store();
      return <Group pending={() => <p>loading</p>}><p>{store.user.name}</p></Group>;
    }`,
  steps: [{ respond: '/unnamed/class', value: { name: 'Ada' } }],
  check: shown,
});

behaves('unnamed reads: a Map entry waits for its source', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    export function App() {
      const sources = new Map([['user', $fetch('/unnamed/map')]]);
      return <Group pending={() => <p>loading</p>}><p>{sources.get('user').name}</p></Group>;
    }`,
  steps: [{ respond: '/unnamed/map', value: { name: 'Ada' } }],
  check: shown,
});

behaves('unnamed reads: a call returning a source waits for it', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    const user = $fetch('/unnamed/call');
    const sources = [() => user];
    export function App() {
      return <Group pending={() => <p>loading</p>}><p>{sources[0]().name}</p></Group>;
    }`,
  steps: [{ respond: '/unnamed/call', value: { name: 'Ada' } }],
  check: shown,
});

behaves('unnamed reads: a failed source reached through a Map shows the error view', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    export function App() {
      const sources = new Map([['user', $fetch('/unnamed/failed')]]);
      return <Group pending={() => <p>loading</p>} error={() => <p>failed</p>}><p>{sources.get('user').name}</p></Group>;
    }`,
  steps: [{ respond: '/unnamed/failed', status: 500, value: { message: 'no' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'failed'][observation]);
  },
});

// The read starts only when a later write chooses its branch, through a helper the compiler sees.
behaves('unnamed reads: a read that starts after mount waits too', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    const sources = new Map([['user', $fetch('/unnamed/later')]]);
    function name(user) { return user.name; }
    export function App() {
      let shown = true;
      return <Group pending={() => <p>loading</p>}><p>{shown ? 'ok' : name(sources.get('user'))}</p>
        <button onClick={() => { shown = false; }}>show</button></Group>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['ok', 'loading'][observation]);
  },
});
