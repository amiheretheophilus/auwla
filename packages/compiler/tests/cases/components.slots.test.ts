/**
 * Component slots (`wiki/compiler/components.md`, "Slots"). Lowercase `<slot>` is compiler syntax:
 * the default slot shows the caller's unmarked content (`children`), `<slot name="x">` shows the
 * content marked `slot="x"`, and a placeholder's own children are its fallback while the slot's
 * value is `undefined`. Expected values validate the reference too (`tests/reference/slots.ts`).
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

const text = (container: HTMLElement, selector: string) => container.querySelector(selector)?.textContent;

behaves('slots: the default slot shows the caller\'s content, or its fallback', {
  source: `
    function Button() { return <button><slot>Continue</slot></button>; }
    export function App() { return <main><Button /><Button>Save</Button></main>; }`,
  check(container) {
    expect([...container.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Continue', 'Save']);
  },
});

behaves('slots: named slots take marked children in order, and the marker is not an attribute', {
  source: `
    function Panel() {
      return <section>
        <header><slot name="header">Untitled</slot></header>
        <main><slot /></main>
        <footer><slot name="actions" /></footer>
      </section>;
    }
    export function App() {
      return <Panel>
        <button slot="actions">Cancel</button>
        <h1 slot="header">Account</h1>
        <p>Body</p>
        <button slot="actions">Save</button>
      </Panel>;
    }`,
  check(container) {
    expect(text(container, 'header')).toBe('Account');
    expect(text(container, 'main')).toBe('Body');
    expect(text(container, 'footer')).toBe('CancelSave');
    expect(container.querySelector('[slot]')).toBeNull();
  },
});

behaves('slots: content follows the caller\'s state and a fallback follows the component\'s', {
  source: `
    function Panel() {
      let opened = 0;
      return <section>
        <header><slot name="header">Untitled {opened}</slot></header>
        <main><slot /></main>
        <button id="open" onClick={() => opened++}>open</button>
      </section>;
    }
    export function App() {
      let count = 1;
      return <div>
        <Panel><p>Body {count}</p></Panel>
        <button id="more" onClick={() => count++}>more</button>
      </div>;
    }`,
  steps: [{ click: '#more' }, { click: '#open' }],
  check(container, observation) {
    expect(text(container, 'main')).toBe(['Body 1', 'Body 2', 'Body 2'][observation]);
    expect(text(container, 'header')).toBe(['Untitled 0', 'Untitled 0', 'Untitled 1'][observation]);
  },
});

behaves('slots: a conditional marked child keeps its place among the others', {
  source: `
    function Bar() { return <nav><slot name="actions" /></nav>; }
    export function App() {
      let extra = false;
      return <div>
        <Bar>
          <b slot="actions">Cancel</b>
          {extra && <i slot="actions">Extra</i>}
          <b slot="actions">Save</b>
        </Bar>
        <button onClick={() => extra = !extra}>toggle</button>
      </div>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(text(container, 'nav')).toBe(['CancelSave', 'CancelExtraSave', 'CancelSave'][observation]);
  },
});

behaves('slots: a value of undefined shows the fallback, and false shows nothing', {
  source: `
    function Box() { return <p><slot>empty</slot></p>; }
    export function App() {
      const nothing = undefined;
      return <main><Box>{nothing}</Box><Box>{false}</Box></main>;
    }`,
  check(container) {
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['empty', '']);
  },
});

behaves('slots: a wrapper forwards its slots into another component\'s', {
  source: `
    function Panel() {
      return <section>
        <header><slot name="header">Panel title</slot></header>
        <main><slot /></main>
        <footer><slot name="actions">No actions</slot></footer>
      </section>;
    }
    function Dialog() {
      return <Panel>
        <slot name="title" slot="header">Dialog title</slot>
        <slot />
        <slot name="buttons" slot="actions" />
      </Panel>;
    }
    export function App() {
      let count = 1;
      return <div>
        <Dialog>
          <h2 slot="title">Delete {count}?</h2>
          <p>This cannot be undone.</p>
          <b slot="buttons">Confirm</b>
        </Dialog>
        <Dialog />
        <button onClick={() => count++}>more</button>
      </div>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    const [full, empty] = container.querySelectorAll('section');
    expect(full!.querySelector('header')!.textContent).toBe(['Delete 1?', 'Delete 2?'][observation]!);
    expect(full!.querySelector('main')!.textContent).toBe('This cannot be undone.');
    expect(full!.querySelector('footer')!.textContent).toBe('Confirm');
    // The forwarded title has a fallback; the forwarded buttons have none, so Panel's own shows.
    expect(empty!.querySelector('header')!.textContent).toBe('Dialog title');
    expect(empty!.querySelector('main')!.textContent).toBe('');
    expect(empty!.querySelector('footer')!.textContent).toBe('No actions');
  },
});

behaves('slots: a marked component child does not receive the marker as a prop', {
  source: `
    function Tag(props) { return <i>{Object.keys(props).join(',')}</i>; }
    function Bar() { return <nav><slot name="end" /></nav>; }
    export function App() { return <Bar><Tag slot="end" tone="quiet" /></Bar>; }`,
  check(container) {
    expect(text(container, 'nav')).toBe('tone');
  },
});

behaves('slots: spreading a slot component\'s props onto an element adds no slot attributes', {
  source: `
    function Frame(props) {
      return <div><aside {...props}><slot /></aside><nav><slot name="side" /></nav></div>;
    }
    function Card({ title, ...rest }) {
      return <article {...rest}><h1>{title}</h1><slot /></article>;
    }
    export function App() {
      return <main>
        <Frame id="frame"><b slot="side">Side</b><p>Body</p></Frame>
        <Card title="T" id="card"><p>Card body</p></Card>
      </main>;
    }`,
  check(container) {
    expect(container.querySelector('aside')!.getAttributeNames()).toEqual(['id']);
    expect(text(container, 'aside')).toBe('Body');
    expect(text(container, 'nav')).toBe('Side');
    expect(container.querySelector('article')!.getAttributeNames()).toEqual(['id']);
    expect(text(container, 'article')).toBe('TCard body');
  },
});

behaves('slots: a slot shown twice, and beside children, shows the same content each time', {
  source: `
    function Twice(props) { return <p><slot />|<slot />|{props.children}</p>; }
    export function App() {
      let n = 1;
      return <main><Twice><b>{n}</b></Twice><button onClick={() => n++}>+</button></main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(text(container, 'p')).toBe(['1|1|1', '2|2|2'][observation]);
  },
});

behaves('slots: list rows can each target a slot', {
  source: `
    function Menu() { return <div><ul><slot name="items" /></ul><p><slot /></p></div>; }
    export function App() {
      let items = ['a', 'b'];
      return <main>
        <Menu>
          {items.map((item) => <li key={item} slot="items">{item}</li>)}
          Footer
        </Menu>
        <button onClick={() => items = [...items, 'c']}>add</button>
      </main>;
    }`,
  steps: [{ click: 'button' }],
  check(container, observation) {
    expect(text(container, 'ul')).toBe(['ab', 'abc'][observation]);
    expect(text(container, 'p')).toBe('Footer');
  },
});

behaves('slots: a slot inside a conditional of the component shows when it opens', {
  source: `
    function Details() {
      let open = false;
      return <section><button onClick={() => open = !open}>toggle</button>{open && <div><slot /></div>}</section>;
    }
    export function App() { return <Details><p>Inside</p></Details>; }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(text(container, 'section')).toBe(['toggle', 'toggleInside', 'toggle'][observation]);
  },
});

behaves('slots: a component from another module takes slot content', {
  modules: {
    './panel.tsx': `
      export function Panel({ tone }) {
        return <article class={tone}><h1><slot name="title" /></h1><slot /></article>;
      }`,
  },
  source: `
    import { Panel } from './panel';
    export function App() { return <Panel tone="calm"><b slot="title">Title</b><p>Body</p></Panel>; }`,
  check(container) {
    expect(text(container, 'h1')).toBe('Title');
    expect(text(container, 'article')).toBe('TitleBody');
    expect(container.querySelector('article')!.className).toBe('calm');
  },
});
