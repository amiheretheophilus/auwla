/**
 * Programs the wiki listed as not covered yet, each compared with the reference after every step.
 * They mix concepts on purpose (classes with getters, recursive components, patterns over
 * iterators), so they sit here rather than on one concept's page. Numbered so a failure is easy
 * to find.
 */
import { behaves } from '../harness/run';

const button = '<button id="go" onClick={go}>go</button>';

behaves('r01 a class in another file with its own slice, read in render', {
  modules: {
    './list.ts': `
      export class Items {
        constructor() { this.taken = 0; }
        slice() { this.taken++; return this; }
      }
    `,
  },
  source: `
    import { Items } from './list';
    export function App() {
      const items = new Items();
      const go = () => { const copy = items.slice(); copy.taken; };
      return <main><p>{items.taken}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('r02 a class in another file with its own push that does not edit', {
  modules: {
    './list.ts': `
      export class Log {
        constructor() { this.count = 0; this.other = 0; }
        push() { this.other++; return this.count; }
      }
    `,
  },
  source: `
    import { Log } from './list';
    const log = new Log();
    export function App() {
      const go = () => { log.push(1); };
      return <main><p>{log.count}:{log.other}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r03 cleanup in a branch that stops being taken', {
  source: `
    const log = [];
    export function App() {
      let on = true;
      if (on) { $cleanup(() => log.push('branch')); }
      const go = () => { on = !on; };
      return <main><p>{on ? 'on' : 'off'}:{log.join()}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('r04 cleanup in a helper called from the body', {
  source: `
    const log = [];
    function track(name) { $cleanup(() => log.push(name)); return name; }
    function Child({ name }) { const shown = track(name); return <i>{shown}</i>; }
    export function App() {
      let on = true;
      const go = () => { on = !on; };
      return <main><p>{log.join()}</p>{on ? <Child name="a" /> : null}${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('r05 cleanup inside a list row', {
  source: `
    const log = [];
    function Row({ id }) { $cleanup(() => log.push(id)); return <li>{id}</li>; }
    export function App() {
      let rows = [1, 2, 3];
      const go = () => { rows = rows.slice(1); };
      return <main><p>{log.join()}</p><ul>{rows.map((id) => <Row key={id} id={id} />)}</ul>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('r06 an async effect whose result arrives after a newer run', {
  source: `
    export function App() {
      let id = 1;
      let shown = 'none';
      $effect(async () => {
        const current = id;
        const value = await defer('e' + current);
        shown = 'got' + value + ':' + current;
      });
      const go = () => { id++; };
      return <main><p>{shown}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { resolve: 'e2', value: 'B' }, { resolve: 'e1', value: 'A' }],
});

behaves('r07 an async helper with reads before its first await', {
  source: `
    export function App() {
      let n = 1;
      let seen = 0;
      async function read() { seen = n; await Promise.resolve(); seen = seen + 10; }
      const go = () => { n++; read(); };
      return <main><p>{n}:{seen}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('r08 a recursive tree of components with state', {
  source: `
    function Node({ node }) {
      let open = true;
      return <li><b onClick={(event) => { event.stopPropagation(); open = !open; }}>{node.name}:{String(open)}</b>
        {open && node.kids.length > 0 ? <ul>{node.kids.map((kid) => <Node key={kid.name} node={kid} />)}</ul> : null}</li>;
    }
    export function App() {
      let tree = { name: 'root', kids: [{ name: 'a', kids: [{ name: 'a1', kids: [] }] }, { name: 'b', kids: [] }] };
      const go = () => { tree.kids[0].name = 'A'; tree.kids.push({ name: 'c', kids: [] }); };
      return <main><ul><Node node={tree} /></ul>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: 'li li b' }, { click: '#go' }],
});

behaves('r09 a computed member tag that changes', {
  source: `
    const views = { a({ v }) { return <b>a:{v}</b>; }, b({ v }) { return <i>b:{v}</i>; } };
    export function App() {
      let key = 'a';
      let v = 1;
      const Shown = views[key];
      const go = () => { key = key === 'a' ? 'b' : 'a'; v++; };
      return <main><Shown v={v} />${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('r10 a factory making components, with state kept per instance', {
  source: `
    function make(label) {
      return function Made({ n }) {
        let own = 0;
        return <b onClick={() => own++}>{label}:{n}:{own}</b>;
      };
    }
    const First = make('x');
    export function App() {
      let n = 1;
      const go = () => { n++; };
      return <main><First n={n} />${button}</main>;
    }
  `,
  steps: [{ click: 'b' }, { click: '#go' }, { click: 'b' }],
});

behaves('r11 a getter on a class reading module state', {
  source: `
    let total = 1;
    class View { get doubled() { return total * 2; } }
    const view = new View();
    export function App() {
      const go = () => { total++; };
      const { doubled } = view;
      return <main><p>{view.doubled}:{doubled}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r12 destructuring with defaults and rest, from state', {
  source: `
    export function App() {
      let box = { a: 1, c: 3, d: 4 };
      const { a, b = a + 1, ...rest } = box;
      const go = () => { box = { a: 5, b: 6, e: 7 }; };
      return <main><p>{a}:{b}:{Object.keys(rest).join()}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r13 array destructuring from a Set and a generator', {
  source: `
    export function App() {
      let n = 1;
      const [first, second] = new Set([n, n + 1]);
      const [one] = (function* () { yield n * 10; })();
      const go = () => { n++; };
      return <main><p>{first}:{second}:{one}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r14 for-of destructuring over getters', {
  source: `
    let count = 1;
    const boxes = [{ get value() { return count; } }];
    export function App() {
      let total = 0;
      for (const { value } of boxes) total += value;
      const go = () => { count++; };
      return <main><p>{total}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r15 a labelled block, switch and try that build a value', {
  source: `
    export function App() {
      let n = 1;
      let out = 'none';
      block: {
        if (n > 2) { out = 'big'; break block; }
        try { if (n === 2) throw new Error('two'); out = 'one'; }
        catch (error) { out = error.message; }
        finally { out += '!'; }
      }
      const go = () => { n++; };
      return <main><p>{out}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }],
});

behaves('r16 a Symbol keyed and a private field edit', {
  source: `
    const key = Symbol('k');
    class Box { #v = 1; get v() { return this.#v; } inc() { this.#v++; } }
    export function App() {
      const box = new Box();
      const data = { [key]: 1 };
      const go = () => { box.inc(); data[key]++; };
      return <main><p>{box.v}:{data[key]}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r17 a Date, Map and Set edited in a handler', {
  source: `
    export function App() {
      const when = new Date(0);
      const map = new Map([['a', 1]]);
      const set = new Set([1]);
      const go = () => { when.setFullYear(2000); map.set('b', 2); set.add(2); };
      return <main><p>{when.getFullYear()}:{map.size}:{set.size}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r18 a nested function in a list callback reads the row and state', {
  source: `
    export function App() {
      let suffix = '!';
      let rows = [{ id: 1, n: 'a' }];
      const go = () => { suffix = '?'; rows[0].n = 'b'; };
      return <main><ul>{rows.map((row) => { const name = () => row.n + suffix; return <li key={row.id}>{name()}</li>; })}</ul>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r19 export default of a component through several files', {
  modules: {
    './A.tsx': `export default function A({ n }) { return <b>{n}</b>; }`,
    './b.ts': `export { default } from './A';`,
    './c.ts': `import X from './b'; export default X;`,
  },
  source: `
    import C from './c';
    export function App() {
      let n = 1;
      const go = () => { n++; };
      return <main><C n={n} />${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r20 class field arrow and static block reading state', {
  source: `
    let base = 1;
    class C {
      static made = base * 2;
      value = base + 1;
      read = () => this.value + base;
    }
    export function App() {
      const c = new C();
      const go = () => { base++; };
      return <main><p>{C.made}:{c.value}:{c.read()}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r21 a generator called at once, reading state', {
  source: `
    export function App() {
      let n = 1;
      const [one] = (function* () { yield n * 10; })();
      const go = () => { n++; };
      return <main><p>{one}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r22 a named generator reading state', {
  source: `
    export function App() {
      let n = 1;
      function* walk() { yield n * 10; }
      const [one] = walk();
      const go = () => { n++; };
      return <main><p>{one}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

behaves('r22b a generator held in a variable keeps its progress', {
  source: `
    export function App() {
      let n = 1;
      let seen = [];
      function* walk() { yield n; yield n * 10; }
      const steps = walk();
      const go = () => { n++; seen = [...seen, steps.next().value]; };
      return <main><p>{seen.join()}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }, { click: '#go' }, { click: '#go' }],
});

behaves('r23 an async function reading a local', {
  source: `
    export function App() {
      let n = 1;
      let seen = 0;
      async function load() { return n * 10; }
      const made = load();
      made.then((value) => { seen = value; });
      const go = () => { n++; };
      return <main><p>{seen}</p>${button}</main>;
    }
  `,
  steps: [{ click: '#go' }],
});

// Its declaration is hoisted out of the returning block, and must still be in its dead zone.
behaves('r24 a name in a returning block, read before its declaration', {
  source: `
    export function App() {
      let n = 1;
      let seen = '';
      const read = () => { try { seen = String(label); } catch (error) { seen = error.name; } };
      if (n > 0) {
        read();
        const label = 'x' + n;
        return <p onClick={() => n++}>{seen}:{label}</p>;
      }
      return <p>none</p>;
    }
  `,
  steps: [{ click: 'p' }],
});
