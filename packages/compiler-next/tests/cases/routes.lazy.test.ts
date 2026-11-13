/**
 * Lazy route chunks (`wiki/compiler/routes.md`, "Lazy route chunks"). The harness builds as the
 * browser does (`routedEnvironment: 'client'`), so a component imported only for its routes is
 * loaded by `import()` when its route is first chosen, and before mount when the first route
 * shows it. The reference imports every module up front; the page must be the same either way.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

const text = (container: HTMLElement, selector: string) => container.querySelector(selector)?.textContent ?? null;

behaves('lazy routes: a page loads when a link first chooses its route', {
  url: '/',
  modules: {
    './pages/profile.tsx': `export function Profile() { return <h1 id="title">Profile</h1>; }`,
  },
  source: `
    import { Profile } from './pages/profile';
    export function App() {
      return <main>
        <p id="home" route="/">Home</p>
        <Profile route="/profile" />
        <a id="go" route-to="/profile">profile</a>
        <a id="back" route-to="/">home</a>
      </main>;
    }`,
  steps: [{ click: '#go' }, { click: '#back' }, { click: '#go' }],
  check(container, observation) {
    expect(text(container, '#home')).toBe(['Home', null, 'Home', null][observation]!);
    expect(text(container, '#title')).toBe([null, 'Profile', null, 'Profile'][observation]!);
  },
});

behaves('lazy routes: a page gets its props, children and params', {
  url: '/people/ada',
  modules: {
    './person.tsx': `
      import { route } from '@memoized-dom/router';
      export function Person(props) {
        return <article><h1 id="name">{props.greeting}, {route.params.id}</h1>{props.children}</article>;
      }`,
  },
  source: `
    import { Person } from './person';
    export function App() {
      let greeting = 'Hello';
      return <main>
        <button id="formal" onClick={() => greeting = 'Good day'}>formal</button>
        <Person route="/people/:id" greeting={greeting}><p id="child">child</p></Person>
        <a id="grace" route-to={{ path: '/people/:id', params: { id: 'grace' } }}>grace</a>
      </main>;
    }`,
  steps: [{ click: '#formal' }, { click: '#grace' }],
  check(container, observation) {
    expect(text(container, '#name')).toBe(['Hello, ada', 'Good day, ada', 'Good day, grace'][observation]!);
    expect(text(container, '#child')).toBe('child');
  },
});

behaves('lazy routes: a page\'s module state lasts across visits, and its own state starts afresh', {
  url: '/counter',
  modules: {
    './counter.tsx': `
      let visits = 0;
      export function Counter() {
        visits++;
        let clicks = 0;
        return <section>
          <p id="visits">{visits}</p>
          <button id="click" onClick={() => clicks++}>{clicks}</button>
        </section>;
      }`,
  },
  source: `
    import { Counter } from './counter';
    export function App() {
      return <main>
        <Counter route="/counter" />
        <p id="home" route="/">Home</p>
        <a id="home-link" route-to="/">home</a>
        <a id="counter" route-to="/counter">counter</a>
      </main>;
    }`,
  steps: [{ click: '#click' }, { click: '#home-link' }, { click: '#counter' }],
  check(container, observation) {
    expect(text(container, '#visits')).toBe(['1', '1', null, '2'][observation]!);
    expect(text(container, '#click')).toBe(['0', '1', null, '0'][observation]!);
  },
});

behaves('lazy routes: a lazy page with routes of its own loads its lazy pages too', {
  url: '/settings/profile',
  modules: {
    './settings.tsx': `
      import { Profile } from './profile';
      import { Billing } from './billing';
      export function Settings() {
        return <section>
          <h2>Settings</h2>
          <Profile route="/profile" />
          <Billing route="/billing" />
          <a id="billing" route-to="/settings/billing">billing</a>
        </section>;
      }`,
    './profile.tsx': `export function Profile() { return <p id="page">Profile</p>; }`,
    './billing.tsx': `export function Billing() { return <p id="page">Billing</p>; }`,
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

behaves('lazy routes: a lazy page\'s preparation runs once its module has loaded', {
  url: '/',
  modules: {
    './story.tsx': `
      export function Story() {
        const story = $routed(async ({ params }) => ({ title: 'Story ' + params.id + ': ' + await defer('story') }));
        return <h1 id="title">{story.title}</h1>;
      }`,
  },
  source: `
    import { Story } from './story';
    export function App() {
      return <main>
        <p id="home" route="/">Home</p>
        <Story route="/story/:id" />
        <a id="one" route-to={{ path: '/story/:id', params: { id: 1 } }}>one</a>
      </main>;
    }`,
  steps: [{ click: '#one' }, { resolve: 'story', value: 'ready' }],
  check(container, observation) {
    expect(text(container, '#home')).toBe(['Home', 'Home', null][observation]!);
    expect(text(container, '#title')).toBe([null, null, 'Story 1: ready'][observation]!);
  },
});

behaves('lazy routes: the first route\'s lazy page is loaded and prepared before mount', {
  url: '/story/7',
  modules: {
    './story.tsx': `
      export function Story() {
        const story = $routed(({ params }) => ({ title: 'Story ' + params.id }));
        return <h1 id="title">{story.title}</h1>;
      }`,
  },
  source: `
    import { Story } from './story';
    export function App() {
      return <main><Story route="/story/:id" /><p id="home" route="/">Home</p><a id="home-link" route-to="/">home</a></main>;
    }`,
  steps: [{ click: '#home-link' }],
  check(container, observation) {
    expect(text(container, '#title')).toBe(['Story 7', null][observation]!);
    expect(text(container, '#home')).toBe([null, 'Home'][observation]!);
  },
});
