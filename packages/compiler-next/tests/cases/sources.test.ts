/** Sources and readiness: wiki/compiler/sources.md. Expected values validate the oracle too. */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';
import { requestedUrls, requestSignals } from '../harness/requests';

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

behaves('a null target pauses the request and clears the payload', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    export function App() {
      let id = 1;
      const user = $fetch(id === null ? null : '/user/' + id);
      return (
        <Group pending={() => <i>loading</i>}>
          <p>{user === null ? 'none' : user.name}</p>
          <button onClick={() => { id = null; }}>clear</button>
        </Group>
      );
    }`,
  steps: [{ respond: '/user/1', value: { name: 'Ada' } }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada', 'none'][observation]);
    expect(requestedUrls()).toEqual(['/user/1']);
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

behaves('destructured names follow a changed request input', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    export function App() {
      let id = 1;
      const user = $fetch('/user/' + id);
      const { name, tags: [first] } = user;
      return (
        <Group pending={() => <i>loading</i>}>
          <p>{name}:{first}</p>
          <button onClick={() => { id++; }}>next</button>
        </Group>
      );
    }`,
  steps: [
    { respond: '/user/1', value: { name: 'Ada', tags: ['a'] } },
    { click: 'button' },
    { respond: '/user/2', value: { name: 'Grace', tags: ['g'] } },
  ],
  check(container, observation) {
    const expected = ['loading:loading', 'Ada:a', 'Ada:a', 'Grace:g'];
    expect(container.querySelector('p')?.textContent).toBe(expected[observation]);
  },
});

behaves('destructuring a fetch call directly follows a changed request input', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    export function App() {
      let id = 1;
      const { name } = $fetch('/user/' + id);
      return (
        <Group pending={() => <i>loading</i>}>
          <p>{name}</p>
          <button onClick={() => { id++; }}>next</button>
        </Group>
      );
    }`,
  steps: [
    { respond: '/user/1', value: { name: 'Ada' } },
    { click: 'button' },
    { respond: '/user/2', value: { name: 'Grace' } },
  ],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada', 'Ada', 'Grace'][observation]);
  },
});

behaves('destructured names follow a payload mutation and a refresh', {
  source: `
    import { $fetch, $track, Group } from '@memoized-dom/data';
    export function App() {
      const user = $fetch('/user');
      const request = $track(user);
      const { name } = user;
      return (
        <Group pending={() => <i>loading</i>}>
          <p>{name}</p>
          <button id="rename" onClick={() => { user.name = 'Grace'; }}>rename</button>
          <button id="refresh" onClick={() => request.refresh()}>refresh</button>
        </Group>
      );
    }`,
  steps: [
    { respond: '/user', value: { name: 'Ada' } },
    { click: '#rename' },
    { click: '#refresh' },
    { respond: '/user', value: { name: 'Lin' } },
  ],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada', 'Grace', 'Grace', 'Lin'][observation]);
  },
});

behaves('a written destructured name is a snapshot while its sibling stays derived', {
  source: `
    import { $fetch, $track, Group } from '@memoized-dom/data';
    export function App() {
      const user = $fetch('/user');
      const request = $track(user);
      let { name, role } = user;
      return (
        <Group pending={() => <i>loading</i>}>
          <p>{name}</p>
          <span>{role}</span>
          <button id="pick" onClick={() => { name = 'manual'; }}>pick</button>
          <button id="refresh" onClick={() => request.refresh()}>refresh</button>
        </Group>
      );
    }`,
  steps: [
    { respond: '/user', value: { name: 'Ada', role: 'admin' } },
    { click: '#pick' },
    { click: '#refresh' },
    { respond: '/user', value: { name: 'Lin', role: 'owner' } },
  ],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'Ada', 'manual', 'manual', 'manual'][observation]);
    expect(container.querySelector('span')?.textContent).toBe(['loading', 'admin', 'admin', 'admin', 'owner'][observation]);
  },
});

behaves('suspend publishes static content immediately and emits no directive attribute', {
  source: `
    import { Group } from '@memoized-dom/data';
    export function App() { return <Group suspend pending={() => <i>loading</i>}>
      <section suspend><h1>Ready</h1><p>Once</p></section></Group>; }`,
  check(container) {
    expect(container.textContent).toBe('ReadyOnce');
    expect(container.querySelector('[suspend], group')).toBeNull();
  },
});

behaves('suspend discovers child-owned sources and publishes all siblings together', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    function Child() { const user = $fetch('/child'); return <p id="child">{user.name}</p>; }
    export function App() {
      const user = $fetch('/parent');
      return <Group suspend pending={() => <i>loading</i>}>
        <h1>Static</h1><p id="parent">{user.name}</p><Child /></Group>;
    }`,
  steps: [{ respond: '/parent', value: { name: 'Parent' } }, { respond: '/child', value: { name: 'Child' } }],
  check(container, observation) {
    expect(requestedUrls()).toEqual(['/parent', '/child']);
    expect(container.textContent).toBe(['loading', 'loading', 'StaticParentChild'][observation]!);
    expect(container.querySelector('h1') !== null).toBe(observation === 2);
  },
});

behaves('suspend on a component includes its ordinary descendants', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function Child({ user }) { return <article>{user.name}</article>; }
    function Parent({ user }) { return <section><h1>Shell</h1><Child user={user} /></section>; }
    export function App() {
      const user = $read(defer('user'));
      return <Group pending={() => <i>loading</i>}><Parent suspend user={user} /></Group>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('section') !== null).toBe(observation === 1);
    expect(container.textContent).toBe(['loading', 'ShellAda'][observation]!);
  },
});

behaves('suspend on an element keeps its surrounding component mounted', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function Child({ user }) { return <section><h1>Shell</h1><article suspend>{user.name}</article></section>; }
    export function App() {
      const user = $read(defer('user'));
      return <Group pending={() => <i>loading</i>}><Child user={user} /></Group>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('h1')?.textContent).toBe('Shell');
    expect(container.querySelector('article')?.textContent).toBe([undefined, 'Ada'][observation]);
    expect(container.textContent).toBe(['Shellloading', 'ShellAda'][observation]!);
  },
});

behaves('suspend ignores unused sources and inactive branches', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function Child() {
      const unused = $read(defer('unused'));
      const hidden = $read(defer('hidden'));
      const show = false;
      return <p>{show ? hidden.name : 'off'}</p>;
    }
    export function App() { return <Group suspend pending={() => <i>loading</i>}><Child /></Group>; }`,
  check(container) { expect(container.textContent).toBe('off'); },
});

behaves('suspend does not claim an independent ordinary sibling source', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function Child({ user, unused }) { return <article>{user.name}</article>; }
    export function App() {
      const summary = $read(defer('summary'));
      const user = $read(defer('user'));
      return <Group pending={() => <i>loading</i>}><h1>Shell</h1><p>{summary.text}</p>
        <Child suspend user={user} unused={summary} /></Group>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }, { resolve: 'summary', value: { text: 'Summary' } }],
  check(container, observation) {
    expect(container.querySelector('h1')?.textContent).toBe('Shell');
    expect(container.querySelector('article')?.textContent).toBe([undefined, 'Ada', 'Ada'][observation]);
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'loading', 'Summary'][observation]);
  },
});

behaves('suspend delays refs and effects until the whole subtree is connected', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    let mounts = 0; let starts = 0; let connected = false; let stops = 0; let clears = 0;
    function Child() {
      let box;
      $effect(() => { starts++; connected = box.isConnected && !!document.querySelector('#static'); return () => { stops++; }; });
      return <section ref={[box, () => { mounts++; return () => { clears++; }; }]}>child</section>;
    }
    export function App() {
      const user = $read(defer('user')); let show = true;
      return <main><output>{mounts}:{starts}:{connected ? 'yes' : 'no'}:{stops}:{clears}</output>
        <button onClick={() => { show = false; }}>hide</button>
        {show && <Group suspend pending={() => <i>loading</i>}><h1 id="static">Static</h1><Child /><p>{user.name}</p></Group>}</main>;
    }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('output')?.textContent).toBe(['0:0:no:0:0', '1:1:yes:0:0', '1:1:yes:1:1'][observation]);
    expect(container.querySelector('section') !== null).toBe(observation === 1);
  },
});

behaves('suspend waits for a source consumed only by an active effect', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    let seen = 'none';
    function Child() {
      const user = $read(defer('user'));
      $effect(() => { seen = user.name; });
      return <p>child</p>;
    }
    export function App() { return <main><output>{seen}</output>
      <Group suspend pending={() => <i>loading</i>}><Child /></Group></main>; }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe([undefined, 'child'][observation]);
    expect(container.querySelector('output')?.textContent).toBe(['none', 'Ada'][observation]);
  },
});

behaves('suspend abandons child work and ignores late completions after remount', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    let mounts = 0; let starts = 0;
    function Child() {
      const user = $fetch('/user');
      $effect(() => { starts++; });
      return <p ref={() => { mounts++; }}>{user.name}</p>;
    }
    export function App() {
      let show = true;
      return <main><output>{mounts}:{starts}</output><button onClick={() => { show = !show; }}>toggle</button>
        {show ? <Group suspend pending={() => <i>loading</i>}><Child /></Group> : <b>hidden</b>}</main>;
    }`,
  steps: [
    { click: 'button' }, { click: 'button' },
    { respond: '/user', value: { name: 'Stale' } }, { respond: '/user', value: { name: 'Fresh' } },
  ],
  check(container, observation) {
    expect(requestedUrls()).toHaveLength(observation < 2 ? 1 : 2);
    expect(requestSignals()[0]?.aborted).toBe(observation >= 1);
    expect(container.querySelector('p')?.textContent).toBe([undefined, undefined, undefined, undefined, 'Fresh'][observation]);
    expect(container.querySelector('output')?.textContent).toBe(observation === 4 ? '1:1' : '0:0');
  },
});

behaves('suspend releases an abandoned GET owner without cancelling a shared consumer', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    function Child() { const user = $fetch('/user'); return <article>{user.name}</article>; }
    export function App() {
      const user = $fetch('/user'); let show = true;
      return <Group pending={() => <i>loading</i>}><p>{user.name}</p>
        <button onClick={() => { show = false; }}>hide</button>{show && <Child suspend />}</Group>;
    }`,
  steps: [{ click: 'button' }, { respond: '/user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(requestedUrls()).toEqual(['/user']);
    expect(requestSignals()[0]?.aborted).toBe(false);
    expect(container.querySelector('p')?.textContent).toBe(['loading', 'loading', 'Ada'][observation]);
    expect(container.querySelector('article')).toBeNull();
  },
});

behaves('suspend retries every failed external dependency as one boundary', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const left = $read(defer('left')); const right = $read(defer('right'));
      return <Group suspend pending={() => <i>loading</i>}
        error={({ error, retry }) => <button onClick={retry}>{error.message}</button>}>
        <h1>Static</h1><p>{left.name}:{right.name}</p></Group>;
    }`,
  steps: [
    { reject: 'left', message: 'left failed' }, { reject: 'right', message: 'right failed' }, { click: 'button' },
    { resolve: 'left', value: { name: 'L' } }, { resolve: 'right', value: { name: 'R' } },
  ],
  check(container, observation) {
    expect(container.textContent).toBe(['loading', 'left failed', 'left failed', 'loading', 'loading', 'StaticL:R'][observation]!);
    expect(container.querySelector('h1') !== null).toBe(observation === 5);
  },
});

behaves('suspend rolls back failed child owners and creates fresh work on retry', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    let starts = 0; let mounts = 0;
    function Child() {
      const user = $fetch('/user');
      $effect(() => { starts++; });
      return <p ref={() => { mounts++; }}>{user.name}</p>;
    }
    export function App() { return <main><output>{starts}:{mounts}</output>
      <Group suspend pending={() => <i>loading</i>}
        error={({ error, retry }) => <button onClick={retry}>{error.message}</button>}><h1>Static</h1><Child /></Group></main>; }`,
  steps: [{ respond: '/user', value: { message: 'offline' }, status: 503 }, { click: 'button' }, { respond: '/user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(requestedUrls()).toHaveLength(observation < 2 ? 1 : 2);
    expect(container.querySelector('output')?.textContent).toBe(observation === 3 ? '1:1' : '0:0');
    expect(container.querySelector('h1') !== null).toBe(observation === 3);
    expect(container.querySelector('i, button, p')?.textContent).toBe(['loading', 'offline', 'loading', 'Ada'][observation]);
  },
});

behaves('suspend inherits its outer policy and withholds nested pending policies', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function Child() {
      const user = $read(defer('user'));
      return <Group pending={() => <i>inner</i>}><article suspend>{user.name}</article></Group>;
    }
    export function App() { return <Group pending={() => <i>outer</i>}>
      <Group suspend><h1>Static</h1><Child /></Group></Group>; }`,
  steps: [{ resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.textContent).toBe(['outer', 'StaticAda'][observation]!);
    expect(container.querySelectorAll('i')).toHaveLength(observation === 0 ? 1 : 0);
  },
});

behaves('suspend keeps committed DOM identity during refresh and source replacement', {
  source: `
    import { $read, $track, Group } from '@memoized-dom/data';
    export function App() {
      let user = $read(defer('user')); const state = $track(user);
      return <main><button id="refresh" onClick={() => state.refresh()}>refresh</button>
        <button id="replace" onClick={() => { user = $read(defer('replacement')); }}>replace</button>
        <Group pending={() => <i>loading</i>}><article suspend>{user.name}</article></Group></main>;
    }`,
  steps: [
    { resolve: 'user', value: { name: 'Ada' } }, { click: '#refresh' }, { resolve: 'user', value: { name: 'Grace' } },
    { click: '#replace' }, { resolve: 'replacement', value: { name: 'Lin' } },
  ],
  check(container, observation) {
    expect(container.querySelector('article')?.textContent).toBe([undefined, 'Ada', 'Ada', 'Grace', 'Grace', 'Lin'][observation]);
    if (observation === 1) container.querySelector('article')!.setAttribute('data-kept', 'yes');
    if (observation > 1) expect(container.querySelector('article')?.getAttribute('data-kept')).toBe('yes');
    expect(container.querySelector('i') !== null).toBe(observation === 0);
  },
});

behaves('suspend lifecycle: discovers descendants after a source-dependent branch becomes ready', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    function Child() { const user = $fetch('/child'); return <p>{user.name}</p>; }
    function Parent() {
      const gate = $fetch('/gate');
      if (!gate.show) return <b>off</b>;
      return <section><h1>Static</h1><Child /></section>;
    }
    export function App() { return <Group suspend pending={() => <i>loading</i>}><Parent /></Group>; }`,
  steps: [{ respond: '/gate', value: { show: true } }, { respond: '/child', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(requestedUrls()).toEqual(observation === 0 ? ['/gate'] : ['/gate', '/child']);
    expect(container.textContent).toBe(['loading', 'loading', 'StaticAda'][observation]!);
    expect(container.querySelector('section') !== null).toBe(observation === 2);
  },
});

behaves('suspend lifecycle: replaces a keyed draft and releases its setup exactly once', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    let setups = 0; let cleanups = 0; let starts = 0; let stops = 0;
    function Child({ id }) {
      setups++;
      $cleanup(() => { cleanups++; });
      const user = $fetch('/user/' + id);
      $effect(() => { starts++; return () => { stops++; }; });
      return <p>{user.name}</p>;
    }
    export function App() {
      let id = 1;
      return <main><output>{setups}:{cleanups}:{starts}:{stops}</output><button onClick={() => { id = 2; }}>next</button>
        <Group suspend pending={() => <i>loading</i>}><Child key={id} id={id} /></Group></main>;
    }`,
  steps: [
    { click: 'button' }, { respond: '/user/1', value: { name: 'Stale' } }, { respond: '/user/2', value: { name: 'Fresh' } },
  ],
  check(container, observation) {
    expect(container.querySelector('output')?.textContent).toBe(['1:0:0:0', '2:1:0:0', '2:1:0:0', '2:1:1:0'][observation]);
    expect(requestSignals()[0]?.aborted).toBe(observation > 0);
    expect(container.querySelector('p')?.textContent).toBe([undefined, undefined, undefined, 'Fresh'][observation]);
  },
});

behaves('suspend lifecycle: uses the outer error policy for a failed nested preparation', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function Child() {
      const user = $read(defer('user'));
      return <Group error={({ error }) => <b>inner:{error.message}</b>}><article suspend>{user.name}</article></Group>;
    }
    export function App() { return <Group pending={() => <i>outer pending</i>}
      error={({ error }) => <b>outer:{error.message}</b>}><Group suspend><h1>Static</h1><Child /></Group></Group>; }`,
  steps: [{ reject: 'user', message: 'offline' }],
  check(container, observation) {
    expect(container.textContent).toBe(['outer pending', 'outer:offline'][observation]!);
    expect(container.querySelector('h1, article')).toBeNull();
  },
});

behaves('suspend lifecycle: abandonment preserves a module source for a later consumer', {
  modules: { './session.ts': `import { $fetch } from '@memoized-dom/data'; export const user = $fetch('/session');` },
  source: `
    import { Group } from '@memoized-dom/data';
    import { user } from './session';
    function Child() { return <p>{user.name}</p>; }
    export function App() {
      let show = true;
      return <main><button onClick={() => { show = !show; }}>toggle</button>
        {show && <Group suspend pending={() => <i>loading</i>}><Child /></Group>}</main>;
    }`,
  steps: [{ click: 'button' }, { respond: '/session', value: { name: 'Ada' } }, { click: 'button' }],
  check(container, observation) {
    expect(requestedUrls()).toEqual(['/session']);
    expect(requestSignals()[0]?.aborted).toBe(false);
    expect(container.querySelector('p')?.textContent).toBe([undefined, undefined, undefined, 'Ada'][observation]);
  },
});

behaves('suspend lifecycle: a shared failure uses separate ordinary and atomic policies', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    function Child({ user }) { return <article>{user.name}</article>; }
    export function App() {
      const user = $read(defer('user'));
      return <Group pending={() => <i>ordinary pending</i>} error={({ error }) => <b>ordinary:{error.message}</b>}>
        <h1>Shell</h1><p>{user.name}</p><Group pending={() => <i>atomic pending</i>}
          error={({ error }) => <b>atomic:{error.message}</b>}><Child suspend user={user} /></Group></Group>;
    }`,
  steps: [{ reject: 'user', message: 'offline' }],
  check(container, observation) {
    expect(container.querySelector('h1')?.textContent).toBe('Shell');
    expect(container.querySelector('p')?.textContent).toBe(['ordinary pending', 'ordinary:offline'][observation]);
    expect(container.querySelector('article')).toBeNull();
    expect(container.textContent).toBe(['Shellordinary pendingatomic pending', 'Shellordinary:offlineatomic:offline'][observation]!);
  },
});

behaves('suspend lifecycle: removing an active pending branch releases its child and publishes', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    function Child() { const user = $fetch('/user'); return <article>{user.name}</article>; }
    function Parent({ show }) { return <section><h1>Static</h1>{show ? <Child /> : <p>off</p>}</section>; }
    export function App() {
      let show = true;
      return <main><button onClick={() => { show = false; }}>hide</button>
        <Group suspend pending={() => <i>loading</i>}><Parent show={show} /></Group></main>;
    }`,
  steps: [{ click: 'button' }, { respond: '/user', value: { name: 'Stale' } }],
  check(container, observation) {
    expect(container.querySelector('section')?.textContent).toBe([undefined, 'Staticoff', 'Staticoff'][observation]);
    expect(requestSignals()[0]?.aborted).toBe(observation > 0);
    expect(container.querySelector('article')).toBeNull();
  },
});

behaves('suspend lifecycle: remount after an error starts fresh child work', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    function Child() { const user = $fetch('/user'); return <p>{user.name}</p>; }
    export function App() {
      let show = true;
      return <main><button id="toggle" onClick={() => { show = !show; }}>toggle</button>
        {show && <Group suspend pending={() => <i>loading</i>} error={({ error }) => <b>{error.message}</b>}><Child /></Group>}</main>;
    }`,
  steps: [
    { respond: '/user', value: { message: 'offline' }, status: 503 }, { click: '#toggle' }, { click: '#toggle' },
    { respond: '/user', value: { name: 'Ada' } },
  ],
  check(container, observation) {
    expect(requestedUrls()).toHaveLength(observation < 3 ? 1 : 2);
    expect(container.querySelector('i, b, p')?.textContent).toBe(['loading', 'offline', undefined, 'loading', 'Ada'][observation]);
  },
});

behaves('suspend lifecycle: a new external source replaces failed preparation without remounting', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      let user = $read(defer('initial'));
      return <main><button id="replace" onClick={() => { user = $read(defer('replacement')); }}>replace</button>
        <Group suspend pending={() => <i>loading</i>} error={({ error }) => <b>{error.message}</b>}>
          <h1>Static</h1><p>{user.name}</p></Group></main>;
    }`,
  steps: [
    { reject: 'initial', message: 'offline' }, { click: '#replace' }, { resolve: 'replacement', value: { name: 'Ada' } },
  ],
  check(container, observation) {
    expect(container.querySelector('i, b, p')?.textContent).toBe(['loading', 'offline', 'loading', 'Ada'][observation]);
    expect(container.querySelector('h1') !== null).toBe(observation === 3);
  },
});

behaves('suspend lifecycle: removing a failed branch publishes the remaining active content', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user')); let show = true;
      return <main><button id="hide" onClick={() => { show = false; }}>hide</button>
        <Group suspend pending={() => <i>loading</i>} error={({ error }) => <b>{error.message}</b>}>
          <h1>Static</h1>{show ? <p>{user.name}</p> : <p>off</p>}</Group></main>;
    }`,
  steps: [{ reject: 'user', message: 'offline' }, { click: '#hide' }],
  check(container, observation) {
    expect(container.querySelector('i, b, p')?.textContent).toBe(['loading', 'offline', 'off'][observation]);
    expect(container.querySelector('h1') !== null).toBe(observation === 2);
  },
});

behaves('suspend lifecycle: changed child inputs replace failed work while unrelated renders do not retry', {
  source: `
    import { $fetch, Group } from '@memoized-dom/data';
    function Child({ id }) { const user = $fetch('/user/' + id); return <p>{user.name}</p>; }
    export function App() {
      let id = 1; let count = 0;
      return <main><output>{count}</output><button id="count" onClick={() => count++}>count</button>
        <button id="next" onClick={() => { id = 2; }}>next</button>
        <Group suspend pending={() => <i>loading</i>} error={({ error }) => <b>{error.message}</b>}>
          <Child id={id} /></Group></main>;
    }`,
  steps: [
    { respond: '/user/1', value: { message: 'offline' }, status: 503 }, { click: '#count' },
    { click: '#next' }, { respond: '/user/2', value: { name: 'Ada' } },
  ],
  check(container, observation) {
    expect(requestedUrls()).toEqual(observation < 3 ? ['/user/1'] : ['/user/1', '/user/2']);
    expect(container.querySelector('i, b, p')?.textContent).toBe(['loading', 'offline', 'offline', 'loading', 'Ada'][observation]);
    expect(container.querySelector('output')?.textContent).toBe(observation < 2 ? '0' : '1');
  },
});

behaves('suspend lifecycle: external refresh recovers the same failed source passed to a child', {
  source: `
    import { $read, $track, Group } from '@memoized-dom/data';
    function Child({ user }) { return <p>{user.name}</p>; }
    export function App() {
      const user = $read(defer('user')); const state = $track(user);
      return <main><button id="refresh" onClick={() => state.refresh()}>refresh</button>
        <Group pending={() => <i>loading</i>} error={({ error }) => <b>{error.message}</b>}>
          <Child suspend user={user} /></Group></main>;
    }`,
  steps: [{ reject: 'user', message: 'offline' }, { click: '#refresh' }, { resolve: 'user', value: { name: 'Ada' } }],
  check(container, observation) {
    expect(container.querySelector('i, b, p')?.textContent).toBe(['loading', 'offline', 'loading', 'Ada'][observation]);
  },
});
