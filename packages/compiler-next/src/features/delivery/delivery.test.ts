import { describe, expect, it } from 'bun:test';
import { compileModulesDetailed } from '../../pipeline';
import { htmlKeepsItsShape } from './html-shape';

const MAIN = `import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount('root', App);`;

function plan(app: string, modules: Record<string, string> = {}, main = MAIN) {
  return compileModulesDetailed({ './main.ts': main, './App.tsx': app, ...modules });
}

function html(app: string, modules?: Record<string, string>): string | null {
  const render = plan(app, modules).initialRender;
  return render.kind === 'html' ? render.html : null;
}

describe('a page that cannot change is HTML', () => {
  it('prints plain markup, and says where it goes', () => {
    const { initialRender, initialDelivery } = plan(`export function App() { return <h1>Hello</h1>; }`);
    expect(initialRender).toEqual({ kind: 'html', html: '<h1>Hello</h1>', target: 'root', mountModuleId: './main.ts' });
    expect(initialDelivery).toMatchObject({ html: '<h1>Hello</h1>', target: 'root', browser: 'none' });
  });

  // Each of these sends the whole page to the browser on the old compiler (`wiki/compiler/delivery.md`).
  for (const [name, app, expected] of [
    ['a pure helper', `function up(x) { return x + '!'; } export function App() { return <h1>{up('a')}</h1>; }`, '<h1>a!</h1>'],
    ['a string method', `export function App() { return <h1>{'abc'.toUpperCase()}</h1>; }`, '<h1>ABC</h1>'],
    ['filter and map', `export function App() { const r = [1, 2, 3].filter((x) => x > 1); return <ul>{r.map((x) => <li key={x}>{x}</li>)}</ul>; }`, '<ul><li>2</li><li>3</li></ul>'],
    ['join', `export function App() { return <p>{['a', 'b'].join(',')}</p>; }`, '<p>a,b</p>'],
    ['Math.max', `export function App() { return <p>{Math.max(1, 2)}</p>; }`, '<p>2</p>'],
    ['JSON.stringify', `export function App() { return <p>{JSON.stringify({ a: 1 })}</p>; }`, '<p>{"a":1}</p>'],
    ['Object.keys', `export function App() { const o = { a: 1 }; return <ul>{Object.keys(o).map((k) => <li key={k}>{k}</li>)}</ul>; }`, '<ul><li>a</li></ul>'],
    ['a loop', `export function App() { const r = []; for (let i = 0; i < 2; i++) r.push(i); return <ul>{r.map((x) => <li key={x}>{x}</li>)}</ul>; }`, '<ul><li>0</li><li>1</li></ul>'],
    ['an early return', `export function App() { const on = true; if (on) return <p>a</p>; return <p>b</p>; }`, '<p>a</p>'],
    ['a switch', `export function App() { const k = 'a'; switch (k) { case 'a': return <p>a</p>; default: return <p>b</p>; } }`, '<p>a</p>'],
    ['a class', `class C { v() { return 1; } } export function App() { return <p>{new C().v()}</p>; }`, '<p>1</p>'],
    ['a class list', `export function App() { return <p class={['a', { b: true }]}>x</p>; }`, '<p class="a b">x</p>'],
    ['state that nothing writes', `export function App() { let n = 0; return <p>{n}</p>; }`, '<p>0</p>'],
  ] as const) {
    it(`runs ${name}`, () => {
      expect(html(app)).toBe(expected);
    });
  }

  // An imported function called bare gets `this` undefined, as in the browser, not the imports object.
  it('calls an imported function with no receiver', () => {
    const helper = { './helper.ts': `export function who() { return this === undefined ? 'none' : 'object'; } export function tag() { return this === undefined ? 'none' : 'object'; }` };
    expect(html(`import { who, tag } from './helper'; export function App() { return <p>{who()}:{tag\`x\`}</p>; }`, helper)).toBe('<p>none:none</p>');
  });

  it('prints a style object', () => {
    const printed = html(`export function App() { return <p style={{ color: 'red' }}>a</p>; }`);
    expect(printed).toContain('color: red');
    expect(printed).not.toContain('[object');
  });

  it('follows components and data across files', () => {
    const printed = html(
      `import { Card } from './Card'; import { rows } from './data';
       export function App() { return <main>{rows.map((row) => <Card key={row.id} title={row.title} />)}</main>; }`,
      {
        './Card.tsx': `export function Card({ title }) { return <section><h2>{title}</h2></section>; }`,
        './data.ts': `export const rows = [{ id: 1, title: 'a' }, { id: 2, title: 'b' }];`,
      },
    );
    expect(printed).toBe('<main><section><h2>a</h2></section><section><h2>b</h2></section></main>');
  });

  it('runs a component imported through a re-export and a default', () => {
    const printed = html(
      `import Card from './index'; export function App() { return <Card />; }`,
      {
        './index.ts': `export { default } from './Card';`,
        './Card.tsx': `export default function Card() { return <b>c</b>; }`,
      },
    );
    expect(printed).toBe('<b>c</b>');
  });

  it('handles an import cycle whose functions are hoisted', () => {
    const printed = html(
      `import { a } from './a'; export function App() { return <p>{a()}</p>; }`,
      {
        './a.ts': `import { b } from './b'; export function a() { return b(); } export function one() { return 1; }`,
        './b.ts': `import { one } from './a'; export function b() { return one() + 1; }`,
      },
    );
    expect(printed).toBe('<p>2</p>');
  });

  it('keeps 60 static components out of the browser', () => {
    const cards = Array.from({ length: 60 }, (_, index) => `<Card title="Card ${index}" />`).join('');
    const printed = html(
      `import { Card } from './Card'; export function App() { return <main>${cards}</main>; }`,
      { './Card.tsx': `export function Card({ title }) { return <section><h2>{title}</h2></section>; }` },
    );
    expect(printed?.match(/<section>/g)).toHaveLength(60);
  });
});

describe('a page that needs the browser', () => {
  const needsBrowser = (app: string, modules?: Record<string, string>, main?: string) => {
    expect(plan(app, modules, main).initialRender.kind).toBe('browser');
  };

  it('has a listener, an effect or a ref', () => {
    needsBrowser(`export function App() { let n = 0; return <button onClick={() => n++}>{n}</button>; }`);
    needsBrowser(`export function App() { $effect(() => {}); return <p>a</p>; }`);
    needsBrowser(`export function App() { let r; return <p ref={r}>a</p>; }`);
  });

  it('has a listener in a spread', () => {
    needsBrowser(`export function App() { const on = { onClick() {} }; return <button {...on}>a</button>; }`);
  });

  it('reads the clock, chance, the language or the browser while rendering', () => {
    needsBrowser(`export function App() { return <p>{Date.now()}</p>; }`);
    needsBrowser(`export function App() { return <p>{new Date(0).getFullYear()}</p>; }`);
    needsBrowser(`export function App() { return <p>{Math.random()}</p>; }`);
    needsBrowser(`export function App() { return <p>{(1000).toLocaleString()}</p>; }`);
    needsBrowser(`export function App() { return <p>{window.innerWidth}</p>; }`);
    needsBrowser(`export function App() { console.log('hi'); return <p>a</p>; }`);
  });

  // A stand-in for `window` cannot notice these: `typeof` would say "function" and stay HTML.
  it('looks at a browser global without touching it', () => {
    needsBrowser(`export function App() { return <p>{typeof window}</p>; }`);
    needsBrowser(`export function App() { return <p>{window ? 'yes' : 'no'}</p>; }`);
    needsBrowser(`export function App() { return <p>{String(document === null)}</p>; }`);
    needsBrowser(`function show(x) { return x === undefined; } export function App() { return <p>{String(show(navigator))}</p>; }`);
  });

  // The build runs the root's module, so whatever else the entry runs first is the browser's.
  it('has an entry that runs other modules first', () => {
    const app = `import { shared } from './shared'; export function App() { return <p>{shared.label}</p>; }`;
    const modules = {
      './shared.ts': `export const shared = { label: 'before' };`,
      './initialize.ts': `import { shared } from './shared'; shared.label = 'after';`,
    };
    needsBrowser(app, modules, `import './initialize'; ${MAIN}`);
    needsBrowser(app, modules, `import { shared } from './shared'; shared; ${MAIN}`);
  });

  it('notices a stopped run even when authored code catches it', () => {
    needsBrowser(`export function App() { let w = 0; try { w = window.innerWidth; } catch {} return <p>{w}</p>; }`);
  });

  it('leaves locale methods as they were', () => {
    const before = Number.prototype.toLocaleString;
    plan(`export function App() { return <p>{(1000).toLocaleString()}</p>; }`);
    expect(Number.prototype.toLocaleString).toBe(before);
  });

  it('imports a package, or anything at run time', () => {
    needsBrowser(`import { x } from 'pkg'; export function App() { return <p>{x}</p>; }`);
    needsBrowser(`export function App() { import('./other'); return <p>a</p>; }`, { './other.ts': `export const a = 1;` });
  });

  it('throws while rendering, which the browser should show', () => {
    needsBrowser(`export function App() { throw new Error('no'); }`);
  });

  it('has async work that finishes after the page is shown', () => {
    needsBrowser(`export function App() { let n = 0; (async () => { await 0; n = 1; })(); return <p>{n}</p>; }`);
  });

  it('has a mount module doing more than mounting', () => {
    needsBrowser(`export function App() { return <p>a</p>; }`, {}, `${MAIN} console.log('started');`);
  });

  it('has no single root', () => {
    needsBrowser(`export function App() { return <p>a</p>; }`, {}, `import { App } from './App'; export { App };`);
    needsBrowser(`export function App() { return <p>a</p>; }`, {}, `${MAIN} mount('other', App);`);
  });

  it('would change shape in an HTML parser', () => {
    needsBrowser(`export function App() { return <p><div>a</div></p>; }`);
    needsBrowser(`export function App() { return <table><tr><td>a</td></tr></table>; }`);
  });

  it('still compiles its program either way', () => {
    const { output } = plan(`export function App() { let n = 0; return <button onClick={() => n++}>{n}</button>; }`);
    expect(output['./App.tsx']).toContain('function App');
  });
});

describe('html shape', () => {
  it('accepts what parses back the same', () => {
    for (const html of [
      '<main><h1>a</h1><p>b <b>c</b></p></main>',
      '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>',
      '<select><optgroup><option>a</option></optgroup><option>b</option></select>',
      '<svg width="1"><circle r="1"></circle></svg>',
      '<ul><li>a<ul><li>b</li></ul></li></ul>',
      '<pre>a\nb</pre>',
      '<textarea>a &lt;b</textarea>',
      '<style>.a > .b { color: red; }</style>',
      '<input type="text"><br><img src="a">',
      '<a href="x>y">a</a>',
    ]) expect([html, htmlKeepsItsShape(html)]).toEqual([html, true]);
  });

  it('refuses what the parser would change', () => {
    for (const html of [
      '<p><div>a</div></p>',
      '<table><tr><td>a</td></tr></table>',
      '<table>text</table>',
      '<table><div>a</div></table>',
      '<tr><td>a</td></tr>',
      '<select><div>a</div></select>',
      '<a href="x"><a href="y">b</a></a>',
      '<button><button>b</button></button>',
      '<li>a<li>b</li></li>',
      '<h1><h2>a</h2></h1>',
      '<pre>\na</pre>',
      '<textarea>\na</textarea>',
      '<template><p>a</p></template>',
      '<svg><div>a</div></svg>',
      '<p>a\rb</p>',
    ]) expect([html, htmlKeepsItsShape(html)]).toEqual([html, false]);
  });
});
