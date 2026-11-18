import { describe, expect, it } from 'bun:test';
import { pending, isReactive } from '../../core/graph';
import { inspect } from '../../core/graph/test-helpers';

describe('source classification and readiness edges', () => {
  it('recognizes fetch and promise sources and propagates payload dependencies', () => {
    const result = inspect(`
      import { $fetch, $read } from '@memoized-dom/data';
      const user = $fetch('/user');
      const score = $read(Promise.resolve(3));
      const title = user.name.toUpperCase();
      const combined = title + score;`);
    expect(result.node('user').kind).toBe('Source');
    expect(result.node('score').kind).toBe('Source');
    expect(result.node('title').kind).toBe('Derived');
    expect([...pending(result.node('combined'))].map((node) => node.binding.name).sort()).toEqual(['score', 'user']);
  });

  it('retains source identity when request arguments and global inputs change', () => {
    const result = inspect(`
      import { $fetch } from '@memoized-dom/data';
      let id = 1;
      const user = $fetch('/user/' + id);
      const current = $fetch(endpoint);
      function change() { id++; endpoint = '/other'; }`);
    expect(result.node('user').kind).toBe('Source');
    expect(result.node('current').kind).toBe('Source');
    expect(result.reads('user')).toContain('id');
  });

  it('recognizes aliased imports, namespaces and immutable local aliases', () => {
    const result = inspect(`
      import { $fetch as load } from '@memoized-dom/data';
      import * as data from '@memoized-dom/data';
      const read = data['$read'];
      const request = load;
      const left = request('/left');
      const right = read(Promise.resolve('right'));`);
    expect(result.node('left').kind).toBe('Source');
    expect(result.node('right').kind).toBe('Source');
  });

  it('uses binding identities rather than matching method or function names', () => {
    const result = inspect(`
      import { $fetch } from 'another-package';
      const first = $fetch('/first');
      function local($read) { const second = $read(1); return second; }
      const api = { $fetch() { return 1; } };
      const third = api.$fetch();`);
    expect(result.node('first').kind).not.toBe('Source');
    expect(result.node('second').kind).not.toBe('Source');
    expect(result.node('third').kind).not.toBe('Source');
  });

  it('leaves reassigned API aliases opaque instead of following an obsolete value', () => {
    const result = inspect(`
      import { $fetch } from '@memoized-dom/data';
      let load = $fetch;
      function replace() { load = external; }
      const value = load('/user');`);
    expect(result.node('value').kind).not.toBe('Source');
    expect(result.node('value').initial?.opaque).toBe(true);
  });

  it('follows returned values through local helpers, aliases and recursion', () => {
    const result = inspect(`
      import { $fetch } from '@memoized-dom/data';
      function load() { const value = $fetch('/user'); return value; }
      function recurse(n) { if (n) return recurse(n - 1); return load(); }
      const alias = recurse;
      const user = alias(2);`);
    expect(result.node('user').kind).toBe('Source');
  });

  it('follows imported helpers through linked re-exports', () => {
    const result = inspect(`
      import { load } from './barrel';
      const user = load(1);`, {
      './barrel.ts': `export { getUser as load } from './users';`,
      './users.ts': `
        import { $fetch as request } from '@memoized-dom/data';
        export function getUser(id) { return request('/user', { query: { id } }); }`,
    });
    expect(result.node('user').kind).toBe('Source');
  });

  it('follows framework APIs re-exported by an application barrel', () => {
    const result = inspect(`
      import { load, track } from './barrel';
      const user = load('/user'); const request = track(user);`, {
      './barrel.ts': `export { request as load, status as track } from './data';`,
      './data.ts': `export { $fetch as request, $track as status } from '@memoized-dom/data';`,
    });
    expect(result.node('user').kind).toBe('Source');
    expect(pending(result.node('request')).size).toBe(0);
  });

  it('keeps source aliases derived with the original pending root', () => {
    const result = inspect(`
      import { $fetch } from '@memoized-dom/data';
      const user = $fetch('/user'); const copy = user; const name = copy.name;`);
    expect(result.node('copy').kind).toBe('Derived');
    expect([...pending(result.node('name'))].map((node) => node.binding)).toEqual([result.node('user').binding]);
  });

  it('does not label payload reads, promises, iterators or created callbacks sources', () => {
    const result = inspect(`
      import { $fetch } from '@memoized-dom/data';
      const user = $fetch('/user');
      function name() { return user.name; }
      function sideEffect() { $fetch('/side'); return 1; }
      async function promise() { return $fetch('/async'); }
      function* iterator() { yield $fetch('/iterator'); }
      function callback() { return () => $fetch('/callback'); }
      const label = name(); const plain = sideEffect();
      const deferred = promise(); const sequence = iterator(); const saved = callback();`);
    for (const name of ['label', 'plain', 'deferred', 'sequence', 'saved']) {
      expect(result.node(name).kind).not.toBe('Source');
    }
    expect([...pending(result.node('label'))].map((node) => node.binding)).toEqual([result.node('user').binding]);
  });

  it('recognizes source-valued branches without treating a source-valued test as the result', () => {
    const result = inspect(`
      import { $fetch, $read } from '@memoized-dom/data';
      const user = $fetch('/user');
      const chosen = enabled ? $read(promise) : null;
      const label = user ? 'yes' : 'no';
      const sequence = (sideEffect(), $fetch('/other'));`);
    expect(result.node('chosen').kind).toBe('Source');
    expect(result.node('sequence').kind).toBe('Source');
    expect(result.node('label').kind).toBe('Derived');
  });

  it('preserves source takeover sites separately from the initial request', () => {
    const result = inspect(`
      import { $fetch } from '@memoized-dom/data';
      let user = $fetch('/user');
      function select() { user = $fetch('/other'); }`);
    expect(result.node('user').kind).toBe('Source');
    expect(result.node('user').takeovers).toHaveLength(1);
  });

  it('keeps status readers reactive while excluding their payload wait edges', () => {
    const result = inspect(`
      import { $fetch, $track as track } from '@memoized-dom/data';
      const user = $fetch('/user');
      const request = track((user));
      const pending = request.pending;
      const mixed = request.status + user.name;`);
    expect(isReactive(result.node('request'))).toBe(true);
    expect(pending(result.node('request')).size).toBe(0);
    expect(pending(result.node('pending')).size).toBe(0);
    expect([...pending(result.node('mixed'))].map((node) => node.binding)).toEqual([result.node('user').binding]);
  });

  it('does not suppress an actual payload read passed to track', () => {
    const result = inspect(`
      import { $fetch, $track } from '@memoized-dom/data';
      const user = $fetch('/user');
      const request = $track(user.child);`);
    expect([...pending(result.node('request'))].map((node) => node.binding)).toEqual([result.node('user').binding]);
  });

  it('propagates status-only edges through a visible helper without blocking it', () => {
    const result = inspect(`
      import { $fetch, $track } from '@memoized-dom/data';
      const user = $fetch('/user');
      function status() { return $track(user).status; }
      const label = status();`);
    expect(result.reads('label')).toContain('user');
    expect(pending(result.node('label')).size).toBe(0);
  });

  it('follows source handles passed through status-only helper parameters', () => {
    const result = inspect(`
      import { $fetch, $track } from '@memoized-dom/data';
      function status(value) { return $track(value).status; }
      function forward(value) { return status(value); }
      const user = $fetch('/user'); const label = forward(user);`);
    expect(isReactive(result.node('label'))).toBe(true);
    expect(pending(result.node('label')).size).toBe(0);
  });

  it('retains a payload wait when a helper parameter has mixed uses', () => {
    const result = inspect(`
      import { $fetch, $track } from '@memoized-dom/data';
      function summary(value) { return $track(value).status + value.name; }
      const user = $fetch('/user'); const label = summary(user);`);
    expect([...pending(result.node('label'))].map((node) => node.binding)).toEqual([result.node('user').binding]);
  });

  it('distinguishes GET sources from action promises and unknown methods', () => {
    const result = inspect(`
      import { $fetch } from '@memoized-dom/data';
      const loaded = $fetch('/get', { method: 'get' });
      const action = $fetch('/post', { method: 'POST' });
      const unknown = $fetch('/unknown', options);
      const spread = $fetch('/spread', { ...options });`);
    expect(result.node('loaded').kind).toBe('Source');
    for (const name of ['action', 'unknown', 'spread']) expect(result.node(name).kind).not.toBe('Source');
  });

  it('leaves the authored tree unchanged', () => {
    const result = inspect(`
      import { $fetch, $track } from '@memoized-dom/data';
      const user = $fetch('/user'); const request = $track(user);`);
    expect(result.graph.resolved.modules.map((entry) => JSON.stringify(entry.module.ast))).toEqual(result.before);
  });
});
