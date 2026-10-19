/** Sources and readiness: wiki/compiler/sources.md. Expected values validate the oracle too. */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';
import { requestedUrls } from '../harness/requests';

behaves('a read waits before deriving through a helper', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function shout(value) { return value.toUpperCase() + '!'; }
    export function App() {
      const user = $read(defer('user'));
      const title = shout(user.name);
      return <Group pending={() => <i>loading</i>}><h1>{title}</h1><p>static</p></Group>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('h1')?.textContent).toBe(['loading', 'ADA!'][observation]);
    expect(container.querySelector('p')?.textContent).toBe('static');
  },
});

behaves('a fetch waits before rendering and starts once', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    export function App() {
      const user = $fetch('/user');
      return <Group pending={() => <i>loading</i>}><p>{user.name}</p></Group>;
    }`,
  steps: [{ respond: '/user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada'][observation]);
    expect(requestedUrls()).toEqual(['/user']);
  },
});

behaves('state seeded from a source waits then becomes a snapshot', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      const name = user.name;
      let selected = name;
      return <Group pending={() => <i>loading</i>}><p>{selected}</p>
        <button onClick={() => { selected = 'manual'; }}>pick</button></Group>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada', 'manual'][observation]);
  },
});

behaves('a write before a source seed is ready wins over the seed', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      let selected = user.name;
      return <Group pending={() => <i>loading</i>}><p>{selected}</p>
        <button onClick={() => { selected = 'manual'; }}>pick</button></Group>;
    }`,
  steps: [{ click: 'button' }, { resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'manual', 'manual'][observation]);
  },
});

behaves('an effect waits through a derived source value', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      const title = user.name.toUpperCase();
      let seen = 'not run';
      let runs = 0;
      $effect(() => { seen = title; runs++; });
      return <Group pending={() => <i>loading</i>}><h1>{title}</h1><p>{seen} {runs}</p></Group>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['not run 0', 'ADA 1'][observation]);
  },
});

behaves('an early return waits for its condition', {
  source: `
    import { $read } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      if (user === null) return <p>signed out</p>;
      return <p>{user.name}</p>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.textContent).toBe(['', 'Ada'][observation]!);
  },
});

behaves('a chained request does not start with an unresolved argument', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    function commentsFor(slug) { return $fetch('/comments/' + slug); }
    export function App() {
      const article = $fetch('/article');
      const comments = commentsFor(article.slug);
      return <Group pending={() => <i>loading</i>}><ul>{comments.map(text => <li key={text}>{text}</li>)}</ul></Group>;
    }`,
  steps: [{ respond: '/article', value: { slug: 'hello' } }, { respond: '/comments/hello', value: ['first'] }],
  check(container, observation) {
    expect(requestedUrls()).toEqual(observation === 0 ? ['/article'] : ['/article', '/comments/hello']);
    expect(container.querySelector('ul')?.textContent).toBe(['loading', 'loading', 'first'][observation]);
  },
});

behaves('Group policies inherit independently through child components', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function Child({ user }) {
      return <Group error={({ error }) => <b>{error.kind}:{error.requestKind}:{error.message}</b>}>
        <section><h2>child</h2><p>{user.name}</p></section></Group>;
    }
    export function App() {
      const user = $read(defer('user'));
      return <Group pending={() => <i>outer pending</i>}><Group><Child user={user} /></Group></Group>;
    }`,
  steps: [{ reject: 'user', message: 'offline' }],
  check(container, observation) {
    expect(container.querySelector('h2')?.textContent).toBe('child');
    expect(container.querySelector('p')?.textContent).toBe(['outer pending', 'request:promise:offline'][observation]);
    expect(container.querySelector('group')).toBeNull();
  },
});

behaves('independent source sites settle independently', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const left = $read(defer('left'));
      const right = $read(defer('right'));
      return <Group pending={() => <i>loading</i>}><p id="left">{left}</p><p id="right">{right}</p></Group>;
    }`,
  steps: [{ resolve: 'right', value: 'R' }, { resolve: 'left', value: 'L' }],
  check(container, observation) {
    expect(container.querySelector('#left')?.textContent).toBe(['loading', 'loading', 'L'][observation]);
    expect(container.querySelector('#right')?.textContent).toBe(['loading', 'R', 'R'][observation]);
  },
});

behaves('a failed read retries by replaying the creation expression', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      return <Group pending={() => <i>loading</i>}
        error={({ error, retry }) => <button onClick={retry}>{error.message}</button>}><p>{user.name}</p></Group>;
    }`,
  steps: [{ reject: 'user', message: 'offline' }, { click: 'button' }, { resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'offline', 'loading', 'Ada'][observation]);
  },
});

behaves('a failed fetch exposes HTTP detail and retries', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    export function App() {
      const user = $fetch('/user');
      return <Group pending={() => <i>loading</i>}
        error={({ error, retry }) => <button onClick={retry}>{error.requestKind}:{error.status}:{error.message}</button>}>
        <p>{user.name}</p></Group>;
    }`,
  steps: [{ respond: '/user', value: { message: 'offline' }, status: 503 }, { click: 'button' }, { respond: '/user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'http:503:offline', 'loading', 'Ada'][observation]);
    expect(requestedUrls()).toHaveLength(observation < 2 ? 1 : 2);
  },
});

behaves('a module source and an imported helper preserve readiness', {
  modules: {
    './data/session.ts': `import { $fetch } from '@memoized-dom/data'; export const user = $fetch('/session');`,
    './data/name.ts': `import { user } from './session'; export function userName() { return user.name.toUpperCase(); }`,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { userName } from './data/name';
    export function App() {
      const title = userName();
      return <Group pending={() => <i>loading</i>}><h1>{title}</h1></Group>;
    }`,
  steps: [{ respond: '/session', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('h1')?.textContent).toBe(['loading', 'ADA'][observation]);
    expect(requestedUrls()).toEqual(['/session']);
  },
});

behaves('an imported source helper waits for its argument', {
  modules: {
    './data/comments.ts': `
      import { $fetch } from '@memoized-dom/data';
      export function commentsFor(slug) { return $fetch('/comments/' + slug); }`,
  },
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    import { commentsFor } from './data/comments';
    export function App() {
      const article = $fetch('/article');
      const comments = commentsFor(article.slug);
      return <Group pending={() => <i>loading</i>}><p>{comments.join(',')}</p></Group>;
    }`,
  steps: [{ respond: '/article', value: { slug: 'hello' } }, { respond: '/comments/hello', value: ['one', 'two'] }],
  check(container, observation) {
    expect(requestedUrls()).toEqual(observation === 0 ? ['/article'] : ['/article', '/comments/hello']);
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'loading', 'one,two'][observation]);
  },
});

behaves('aliased source imports have the same readiness behavior', {
  source: `
    import { $read as read, Group as Scope } from '@memoized-dom/data';
    export function App() {
      const value = read(defer('value'));
      return <Scope pending={() => <i>loading</i>}><p>{value === null ? 'null' : value}</p></Scope>;
    }`,
  steps: [{ resolve: 'value', value: null }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'null'][observation]);
  },
});

behaves('undefined is a resolved value rather than a pending source', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const value = $read(defer('value'));
      return <Group pending={() => <i>loading</i>}><p>{value === undefined ? 'undefined' : value}</p></Group>;
    }`,
  steps: [{ resolve: 'value' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'undefined'][observation]);
  },
});

behaves('a nested pending override keeps the outer error policy', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      return <Group pending={() => <i>outer pending</i>} error={({ error }) => <b>outer:{error.message}</b>}>
        <Group pending={() => <i>inner pending</i>}><p>{user.name}</p></Group></Group>;
    }`,
  steps: [{ reject: 'user', message: 'offline' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['inner pending', 'outer:offline'][observation]);
  },
});

behaves('status reads stay available and refresh keeps committed content', {
  source: `
    import { $read, $track, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      const state = $track(user);
      return <Group pending={() => <i>loading</i>}><h1>{user.name}</h1>
        <p>{state.pending ? 'pending' : state.refreshing ? 'refreshing' : state.status}</p>
        <button onClick={() => state.refresh()}>refresh</button></Group>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }, { click: 'button' }, { resolve: 'user', value: { name: 'Grace' } }],
  check(container, observation) {
    expect(container.querySelector('h1')?.textContent).toBe(['loading', 'Ada', 'Ada', 'Grace'][observation]);
    expect(container.querySelector('p')?.textContent).toBe(['pending', 'success', 'refreshing', 'success'][observation]);
  },
});

behaves('new source assignments keep committed content and the latest assignment wins', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      let user = $read(defer('initial'));
      return <Group pending={() => <i>loading</i>}><p>{user.name}</p>
        <button id="first" onClick={() => { user = $read(defer('first')); }}>first</button>
        <button id="second" onClick={() => { user = $read(defer('second')); }}>second</button></Group>;
    }`,
  steps: [
    { resolve: 'initial', value: { name: 'Ada' } },
    { click: '#first' },
    { click: '#second' },
    { resolve: 'first', value: { name: 'old' } },
    { resolve: 'second', value: { name: 'new' } },
  ],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada', 'Ada', 'Ada', 'Ada', 'new'][observation]);
  },
});

behaves('an unused source and an inactive branch do not block an active site', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const unused = $read(defer('unused'));
      const user = $read(defer('user'));
      let show = false;
      return <Group pending={() => <i>loading</i>}><p>{show ? user.name : 'off'}</p>
        <button onClick={() => { show = true; }}>show</button></Group>;
    }`,
  steps: [{ click: 'button' }, { resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['off', 'off', 'Ada'][observation]);
  },
});

behaves('a conditional derivation waits only for its chosen branch', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      let show = false;
      const title = show ? user.name : 'off';
      return <Group pending={() => <i>loading</i>}><p>{title}</p>
        <button onClick={() => { show = true; }}>show</button></Group>;
    }`,
  steps: [{ click: 'button' }, { resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['off', 'off', 'Ada'][observation]);
  },
});

behaves('a module derivation waits and follows later source refreshes', {
  modules: {
    './session.ts': `
      import { $fetch } from '@memoized-dom/data';
      export const user = $fetch('/session');
      export const title = user.name.toUpperCase();`,
  },
  source: `
    import { $track, Group } from '@memoized-dom/data';
    import { user, title } from './session';
    export function App() {
      const state = $track(user);
      return <Group pending={() => <i>loading</i>}><h1>{title}</h1>
        <button onClick={() => state.refresh()}>refresh</button></Group>;
    }`,
  steps: [{ respond: '/session', value: { name: 'Ada' } }, { click: 'button' }, { respond: '/session', value: { name: 'Grace' } }],
  check(container, observation) {
    expect(container.querySelector('h1')?.textContent).toBe(['loading', 'ADA', 'ADA', 'GRACE'][observation]);
  },
});

behaves('a GET server-function client facade behaves as a source', {
  modules: {
    './users.ts': `
      import { $fetch } from '@memoized-dom/data';
      export function getUser(id) { return $fetch('/_fn/users/getUser', { query: { id } }); }`,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { getUser } from './users';
    export function App() {
      let id = 1;
      const user = getUser(id);
      return <Group pending={() => <i>loading</i>}><p>{user.name}</p>
        <button onClick={() => id++}>next</button></Group>;
    }`,
  steps: [
    { respond: '/_fn/users/getUser?id=1', value: { name: 'Ada' } },
    { click: 'button' },
    { respond: '/_fn/users/getUser?id=2', value: { name: 'Grace' } },
  ],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada', 'Ada', 'Grace'][observation]);
    expect(requestedUrls()).toEqual(observation < 2
      ? ['/_fn/users/getUser?id=1']
      : ['/_fn/users/getUser?id=1', '/_fn/users/getUser?id=2']);
  },
});

behaves('matching GET consumers share the request without sharing their policies', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    function Left() {
      const user = $fetch('/user');
      return <Group pending={() => <i>left loading</i>}><p id="left">{user.name}</p></Group>;
    }
    function Right() {
      const user = $fetch('/user');
      return <Group pending={() => <i>right loading</i>}><p id="right">{user.name}</p></Group>;
    }
    export function App() { return <main><Left /><Right /></main>; }`,
  steps: [{ respond: '/user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('#left')?.textContent).toBe(['left loading', 'Ada'][observation]);
    expect(container.querySelector('#right')?.textContent).toBe(['right loading', 'Ada'][observation]);
    expect(requestedUrls()).toEqual(['/user']);
  },
});

behaves('a remounted source owner starts with its own pending presentation', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function Child() {
      const user = $read(defer('user'));
      return <p>{user.name}</p>;
    }
    export function App() {
      let show = true;
      return <Group pending={() => <i>loading</i>}>{show && <Child />}
        <button onClick={() => { show = !show; }}>toggle</button></Group>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }, { click: 'button' }, { click: 'button' }, { resolve: 'user', value: { name: 'Grace' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada', undefined, 'loading', 'Grace'][observation]);
  },
});

behaves('unused module fetch declarations remain lazy', {
  modules: {
    './session.ts': `
      import { $fetch } from '@memoized-dom/data';
      export const unused = $fetch('/unused');
      export const user = $fetch('/user');`,
  },
  source: `
    import { Group } from '@memoized-dom/data';
    import { user } from './session';
    export function App() {
      return <Group pending={() => <i>loading</i>}><p>{user.name}</p></Group>;
    }`,
  steps: [{ respond: '/user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada'][observation]);
    expect(requestedUrls()).toEqual(['/user']);
  },
});

behaves('source destructuring waits and uses JavaScript defaults and rest', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      const { profile: { name = 'Anonymous' }, tags: [first, ...rest] } = user;
      return <Group pending={() => <i>loading</i>}><p>{name}</p><span>{first}:{rest.join(',')}</span></Group>;
    }`,
  steps: [{ resolve: 'user', value: { profile: {}, tags: ['a', 'b', 'c'] } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Anonymous'][observation]);
    expect(container.querySelector('span')?.textContent).toBe(['loading:loading', 'a:b,c'][observation]);
  },
});

behaves('a destructured seed written before loading keeps its override', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      let { name, role } = user;
      return <Group pending={() => <i>loading</i>}><p>{name}</p><span>{role}</span>
        <button onClick={() => { name = 'manual'; }}>pick</button></Group>;
    }`,
  steps: [{ click: 'button' }, { resolve: 'user', value: { name: 'Ada', role: 'admin' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'manual', 'manual'][observation]);
    expect(container.querySelector('span')?.textContent).toBe(['loading', 'loading', 'admin'][observation]);
  },
});
