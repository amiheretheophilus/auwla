/**
 * Cases for wiki/compiler/core.md, "A namespace and export =": lowered TypeScript compiled like
 * the JavaScript it became, so state and components inside a namespace still update.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

const button = '<button id="go" onClick={go}>go</button>';

behaves('namespace: state read in render, changed by a function inside it', {
  source: `
    namespace Store {
      export let count = 1;
      export function bump() { count++; }
    }
    export function App() {
      const go = () => { Store.bump(); };
      return <main><p>{Store.count}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

// The statement assigns the value it reads, so an edit from a handler must not run it again.
behaves('a statement that creates the value it fills, in a module', {
  source: `
    var store; (function (object) { object.count = 1; })(store || (store = {}));
    let lazy; lazy = lazy || { count: 5 };
    export function App() {
      const go = () => { store.count++; lazy.count++; };
      return <main><p>{store.count}:{lazy.count}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('a statement that creates the value it fills, in a component', {
  source: `
    export function App() {
      var store; (function (object) { object.count = 1; })(store || (store = {}));
      let lazy; lazy = lazy || { count: 5 };
      const go = () => { store.count++; lazy.count++; };
      return <main><p>{store.count}:{lazy.count}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('namespace: state changed from outside it', {
  source: `
    namespace Store { export let count = 1; export const items = ['a']; }
    export function App() {
      const go = () => { Store.count += 2; Store.items.push('b'); };
      return <main><p>{Store.count}:{Store.items.join()}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('namespace: a component inside it, with its own state', {
  source: `
    namespace Ui {
      const prefix = 'n';
      export function Counter({ start }) {
        let own = start;
        return <b onClick={() => own++}>{prefix}:{own}</b>;
      }
    }
    export function App() {
      let start = 1;
      const go = () => { start++; };
      return <main><Ui.Counter start={start} /><p>{start}</p>${button}</main>;
    }
  `,
  steps: [{ click: 'b' }, { click: '#go' }, { click: 'b' }],
});

behaves('namespace: components that use each other by their bare names', {
  source: `
    namespace Ui {
      export function Label({ text }) { return <i>{text}</i>; }
      export function Card({ text }) { return <section><Label text={text} /></section>; }
    }
    export function App() {
      let text = 'a';
      const go = () => { text = text + '!'; };
      return <main><Ui.Card text={text} />${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('namespace: merged blocks, a dotted name and an enum', {
  source: `
    namespace Model.Kinds { export enum Kind { Small, Large } }
    namespace Model { export function name(kind) { return Kinds.Kind[kind]; } }
    namespace Model { export const first = name(Kinds.Kind.Large); }
    export function App() {
      let kind = Model.Kinds.Kind.Small;
      const go = () => { kind = Model.Kinds.Kind.Large; };
      return <main><p>{Model.first}:{Model.name(kind)}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('namespace: a derived value from a member', {
  source: `
    namespace Prices { export let rate = 2; export function raise() { rate = rate * 2; } }
    export function App() {
      let amount = 3;
      const total = amount * Prices.rate;
      const go = () => { amount++; Prices.raise(); };
      return <main><p>{total}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('namespace: exported from another file, and read through an import', {
  modules: {
    './store.ts': `
      export namespace Store {
        export let count = 1;
        export function bump() { count++; }
      }
    `,
  },
  source: `
    import { Store } from './store';
    export function App() {
      const go = () => { Store.bump(); };
      return <main><p>{Store.count}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('namespace: merged with a function, as a component with a helper', {
  source: `
    function Badge({ n }) { return <b>{Badge.label}:{n}</b>; }
    namespace Badge { export const label = 'badge'; }
    export function App() {
      let n = 1;
      const go = () => { n++; };
      return <main><Badge n={n} />${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('namespace: only types leaves nothing behind', {
  source: `
    namespace Types { export type Id = number; export interface Row { id: Id } }
    export function App() {
      let row: Types.Row = { id: 1 };
      const go = () => { row = { id: row.id + 1 }; };
      return <main><p>{row.id}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('alias: import x = a.b reads a namespace member', {
  source: `
    namespace Deep.Inner { export function Tag({ n }) { return <b>{n}</b>; } export const base = 10; }
    import Inner = Deep.Inner;
    import Tag = Deep.Inner.Tag;
    export function App() {
      let n = 1;
      const go = () => { n++; };
      return <main><Tag n={n + Inner.base} />${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('export =: a value, imported by require and as a default', {
  modules: {
    './settings.ts': `
      const settings = { scale: 2 };
      export = settings;
    `,
    './other.ts': `
      import viaRequire = require('./settings');
      export const scale = viaRequire.scale;
    `,
  },
  source: `
    import settings from './settings';
    import { scale } from './other';
    export function App() {
      let n = 1;
      const go = () => { n++; };
      return <main><p>{n * settings.scale * scale}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('export =: a component', {
  modules: {
    './Tag.tsx': `
      function Tag({ n }) { return <b>{n}</b>; }
      export = Tag;
    `,
  },
  source: `
    import Tag = require('./Tag');
    export function App() {
      let n = 1;
      const go = () => { n++; };
      return <main><Tag n={n} />${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('export =: a namespace with state', {
  modules: {
    './store.ts': `
      namespace Store {
        export let count = 1;
        export function bump() { count++; }
      }
      export = Store;
    `,
  },
  source: `
    import Store = require('./store');
    export function App() {
      const go = () => { Store.bump(); };
      return <main><p>{Store.count}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('require: a module without export = gives its namespace object', {
  modules: {
    './parts.ts': `
      export const first = 'a';
      export default 'b';
      export let count = 1;
      export function bump() { count++; }
    `,
  },
  source: `
    import parts = require('./parts');
    export function App() {
      const go = () => { parts.bump(); };
      return <main><p>{parts.first}:{parts.default}:{parts.count}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

// TypeScript keeps an exported function local in its own block: it is hoisted before `N.read = read`
// runs, and a call keeps `this` undefined. The reference lowers the same way, so the check is explicit.
behaves('namespace: an exported function called before its declaration, and its receiver', {
  source: `
    namespace N {
      export const value = read();
      export const receiver = whoCalls();
      export function read() { return 1; }
      export function whoCalls() { return this === undefined ? 'none' : 'namespace'; }
    }
    export function App() {
      return <main><p>{N.value}:{N.receiver}:{N.read()}</p></main>;
    }
  `,
  check(container) {
    expect(container.querySelector('p')!.textContent).toBe('1:none:1');
  },
});
