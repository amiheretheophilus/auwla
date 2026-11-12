/**
 * Routes (`wiki/compiler/routes.md`): `route="…"` regions, nested routes joining their patterns,
 * routes inside components in one or several route contexts, and `route-to` links. Each case
 * starts at `url`, and every observation records the location, so a link must navigate to the
 * same place on the reference (`tests/reference/routes.ts`) and in compiled code.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

const text = (container: HTMLElement, selector: string) => container.querySelector(selector)?.textContent ?? null;

behaves('routes: a region shows while its route matches, and a link navigates', {
  url: '/',
  source: `
    function About() { return <p id="about">About us</p>; }
    export function App() {
      return <main>
        <nav><a id="home" route-to="/">Home</a><a id="go" route-to="/about">About</a></nav>
        <section route="/"><h1>Home</h1></section>
        <About route="/about" />
      </main>;
    }`,
  steps: [{ click: '#go' }, { click: '#home' }],
  check(container, observation) {
    expect(text(container, 'h1')).toBe(['Home', null, 'Home'][observation]!);
    expect(text(container, '#about')).toBe([null, 'About us', null][observation]!);
    expect(container.querySelector('[route]')).toBeNull();
    expect(container.querySelector('#go')!.getAttribute('href')).toBe('/about');
  },
});

behaves('routes: a layout stays mounted while the routes inside it change', {
  url: '/settings/profile',
  source: `
    function Profile() { return <p id="page">Profile</p>; }
    function Security() { return <p id="page">Security</p>; }
    export function App() {
      let opened = 0;
      return <main>
        <section route="/settings">
          <button id="open" onClick={() => opened++}>opened {opened}</button>
          <a id="security" route-to="/settings/security">Security</a>
          <a id="settings" route-to="/settings">Settings</a>
          <Profile route="/profile" />
          <Security route="/security" />
          <p id="page" route="/">Pick one</p>
        </section>
      </main>;
    }`,
  steps: [{ click: '#open' }, { click: '#security' }, { click: '#settings' }],
  check(container, observation) {
    expect(text(container, '#page')).toBe(['Profile', 'Profile', 'Security', 'Pick one'][observation]!);
    expect(text(container, '#open')).toBe(observation === 0 ? 'opened 0' : 'opened 1');
  },
});

behaves('routes: a new path starts the page afresh, and params build the link', {
  url: '/story/1',
  source: `
    function Story() {
      let likes = 0;
      return <button id="like" onClick={() => likes++}>likes {likes}</button>;
    }
    export function App() {
      let next = 2;
      return <main>
        <Story route="/story/:id" />
        <a id="next" route-to={{ path: '/story/:id', params: { id: next }, query: { tab: 'top' } }}>next</a>
      </main>;
    }`,
  steps: [{ click: '#like' }, { click: '#next' }],
  check(container, observation) {
    expect(text(container, '#like')).toBe(['likes 0', 'likes 1', 'likes 0'][observation]!);
    expect(container.querySelector('#next')!.getAttribute('href')).toBe('/story/2?tab=top');
  },
});

behaves('routes: the most specific route wins, and a catch-all takes the rest', {
  url: '/projects/new',
  source: `
    export function App() {
      return <main>
        <p id="page" route="/projects/new">New project</p>
        <p id="page" route="/projects/:id">A project</p>
        <p id="page" route="/*">Not found</p>
        <a id="one" route-to={{ path: '/projects/:id', params: { id: 'one' } }}>one</a>
        <a id="lost" route-to={{ path: '/*', params: { '*': 'no/where' } }}>lost</a>
      </main>;
    }`,
  steps: [{ click: '#one' }, { click: '#lost' }],
  check(container, observation) {
    expect(text(container, '#page')).toBe(['New project', 'A project', 'Not found'][observation]!);
  },
});

behaves('routes: a component called inside a route joins its routes to it', {
  url: '/docs/intro',
  modules: {
    './docs.tsx': `
      export function Docs() {
        return <article>
          <h2>Docs</h2>
          <p id="page" route="/intro">Introduction</p>
          <p id="page" route="/api">API</p>
          <a id="api" route-to="/docs/api">API</a>
        </article>;
      }`,
  },
  source: `
    import { Docs } from './docs';
    export function App() {
      return <main>
        <section route="/docs"><Docs /></section>
        <p id="home" route="/">Home</p>
      </main>;
    }`,
  steps: [{ click: '#api' }],
  check(container, observation) {
    expect(text(container, '#page')).toBe(['Introduction', 'API'][observation]!);
    expect(text(container, '#home')).toBeNull();
  },
});

behaves('routes: a component rendered in two route contexts has routes in each', {
  url: '/a/edit',
  source: `
    function Editor(props) {
      return <div class={props.tone}>
        <p class="mode" route="/edit">editing</p>
        <p class="mode" route="/view">viewing</p>
      </div>;
    }
    export function App() {
      return <main>
        <section id="a" route="/a"><Editor tone="first" /></section>
        <section id="b" route="/b"><Editor tone="second" /></section>
        <a id="b-view" route-to="/b/view">b</a>
      </main>;
    }`,
  steps: [{ click: '#b-view' }],
  check(container, observation) {
    expect(text(container, '#a .mode')).toBe(['editing', null][observation]!);
    expect(text(container, '#b .mode')).toBe([null, 'viewing'][observation]!);
    expect(container.querySelector('[route\\:context]')).toBeNull();
  },
});

behaves('routes: a component reads the route, and follows navigation', {
  url: '/one',
  source: `
    import { route } from '@memoized-dom/router';
    export function App() {
      return <main>
        <p id="path">{route.pathname}</p>
        <p route="/one">first</p>
        <p route="/two">second</p>
        <a id="two" route-to="/two">two</a>
      </main>;
    }`,
  steps: [{ click: '#two' }],
  check(container, observation) {
    expect(text(container, '#path')).toBe(['/one', '/two'][observation]!);
  },
});

behaves('routes: a routed component with routes of its own nests them under its route', {
  url: '/settings/profile',
  modules: {
    './settings.tsx': `
      function Profile() { return <p id="page">Profile</p>; }
      export function Settings() {
        return <section>
          <h2>Settings</h2>
          <Profile route="/profile" />
          <p id="page" route="/billing">Billing</p>
          <a id="billing" route-to="/settings/billing">Billing</a>
        </section>;
      }`,
  },
  source: `
    import { Settings } from './settings';
    export function App() {
      return <main><Settings route="/settings" /><p id="page" route="/">Home</p></main>;
    }`,
  steps: [{ click: '#billing' }],
  check(container, observation) {
    expect(text(container, '#page')).toBe(['Profile', 'Billing'][observation]!);
    expect(text(container, 'h2')).toBe('Settings');
  },
});

behaves('routes: a component whose markup is a route shows nothing elsewhere', {
  url: '/',
  source: `
    function Banner() { return <aside route="/sale">Sale!</aside>; }
    export function App() {
      return <main><Banner /><p route="/">Home</p><a id="sale" route-to="/sale">sale</a></main>;
    }`,
  steps: [{ click: '#sale' }],
  check(container, observation) {
    expect(text(container, 'aside')).toBe([null, 'Sale!'][observation]!);
  },
});

behaves('routes: a query or hash change keeps the page, and a link follows its state', {
  url: '/story/1',
  source: `
    function Story() {
      let likes = 0;
      return <button id="like" onClick={() => likes++}>likes {likes}</button>;
    }
    export function App() {
      let tab = 'top';
      return <main>
        <Story route="/story/:id" />
        <button id="tab" onClick={() => tab = 'new'}>tab</button>
        <a id="same" route-to={{ path: '/story/:id', params: { id: 1 }, query: { tab } }}>same</a>
      </main>;
    }`,
  steps: [{ click: '#like' }, { click: '#tab' }, { click: '#same' }],
  check(container, observation) {
    expect(text(container, '#like')).toBe(observation === 0 ? 'likes 0' : 'likes 1');
    expect(container.querySelector('#same')!.getAttribute('href')).toBe(observation < 2 ? '/story/1?tab=top' : '/story/1?tab=new');
  },
});

behaves('routes: a component in several contexts can spread its props onto an element', {
  url: '/a/x',
  source: `
    function Tabs({ label, ...rest }) {
      return <nav {...rest}>{label}<b route="/x">X</b><b route="/y">Y</b></nav>;
    }
    export function App() {
      return <main>
        <section route="/a"><Tabs label="A" id="ta" /></section>
        <section route="/b"><Tabs label="B" id="tb" /></section>
        <a id="go" route-to="/b/y">go</a>
      </main>;
    }`,
  steps: [{ click: '#go' }],
  check(container, observation) {
    const nav = container.querySelector('nav')!;
    expect(nav.getAttributeNames()).toEqual(['id']);
    expect(nav.textContent).toBe(['AX', 'BY'][observation]!);
  },
});

behaves('routes: a component in several contexts that takes props as a name', {
  url: '/b/y',
  source: `
    function Tabs(props) {
      return <nav {...props}><b route="/x">X</b><b route="/y">Y</b></nav>;
    }
    export function App() {
      return <main>
        <section route="/a"><Tabs id="ta" /></section>
        <section route="/b"><Tabs id="tb" /></section>
        <a id="go" route-to="/a/x">go</a>
      </main>;
    }`,
  steps: [{ click: '#go' }],
  check(container, observation) {
    const nav = container.querySelector('nav')!;
    expect(nav.getAttributeNames()).toEqual(['id']);
    expect(nav.textContent).toBe(['Y', 'X'][observation]!);
  },
});

behaves('routes: a value derived from the route at setup follows a query change', {
  url: '/p/one?tab=board',
  source: `
    import { route } from '@memoized-dom/router';
    export function App() {
      const tab = route.query.get('tab');
      const id = route.params.id;
      return <main route="/p/:id">
        <p id="t">{id}:{tab}</p>
        <a id="go" route-to={{ path: '/p/:id', params: { id: 'one' }, query: { tab: 'activity' } }}>go</a>
        <a id="two" route-to={{ path: '/p/:id', params: { id: 'two' } }}>two</a>
      </main>;
    }`,
  steps: [{ click: '#go' }, { click: '#two' }],
  check(container, observation) {
    expect(text(container, '#t')).toBe(['one:board', 'one:activity', 'two:'][observation]!);
  },
});
