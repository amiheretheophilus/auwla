/** Where readiness is emitted (`wiki/compiler/sources.md`). Behavior is pinned by `tests/cases/sources.test.ts`. */
import { describe, expect, it } from 'bun:test';
import { analyze } from 'yuku-analyzer';
import { compileModules } from '../../pipeline';

function compile(source: string, modules: Record<string, string> = {}): string {
  return compileModules({ ...modules, './App.tsx': source })['./App.tsx']!;
}

describe('readiness reach', () => {
  it('leaves values that can never hold a source native', () => {
    const output = compile(`
      import { $fetch } from '@memoized-dom/data';
      export function App() {
        let count = 0;
        const user = $fetch('/user');
        const doubled = count * 2;
        const names = ['a', 'b'].map((name) => name.toUpperCase());
        return <main>
          <p>{user.name}</p>
          <b>{doubled}</b>
          <i>{names.join(',')}</i>
          <button onClick={(event) => { count += event.detail; }}>add</button>
        </main>;
      }`);

    expect(output).toMatch(/readSourceValue\(user\)/);
    expect(output).not.toMatch(/readSourceValue\((count|doubled|names|name|event)\)/);
    expect(output).not.toMatch(/whenSourceInputs\(\(\) => \[[^\]]*\b(count|names)\b/);
  });

  it('follows a source through a prop, and only that prop', () => {
    const output = compile(`
      import { $read } from '@memoized-dom/data';
      function Stat({ label, value }) {
        return <p>{label}: {value}</p>;
      }
      export function App() {
        const total = $read(Promise.resolve(3));
        return <Stat label="Total" value={total} />;
      }`);

    expect(output).toMatch(/readSourceValue\(value\)/);
    expect(output).not.toMatch(/readSourceValue\(label\)/);
  });

  it('keeps guarded member refs assignable', () => {
    const output = compile(`
      import { $read } from '@memoized-dom/data';
      export function App({ editor, key }) {
        const label = $read(Promise.resolve('ready'));
        return <main>
          <canvas ref={editor.connect} />
          <div ref={editor[key]} />
          <p>{label}</p>
        </main>;
      }`);

    expect(output).toMatch(/mutationTarget\([^\n]*"connect", [\w$]+\)\.value = _refNode\d+/);
    expect(output).toMatch(/mutationTarget\([^\n]*readSourceValue\(key\), [\w$]+\)\.value = _refNode\d+/);
  });

  it('keeps readiness in the function when a nested block has shared state', () => {
    const source = `
      import { $read } from '@memoized-dom/data';
      export function build(box) {
        if (box.items) {
          const size = measure(box);
          return box.items.map(point => point.x - size.x);
        }

        const size = measure(box);
        return size.x;
      }`;
    const output = compileModules({ './build.ts': source })['./build.ts']!;
    const module = analyze(output, { lang: 'ts', sourceType: 'module' });
    const references = module.references.filter((reference) => /^_source(Step|Binding)/.test(reference.name));
    const unresolved = references.filter((reference) => reference.binding === null);

    expect(references.length).toBeGreaterThan(0);
    expect(unresolved.map((reference) => reference.name)).toEqual([]);
  });

  it('assumes values from unknown code can hold one once a raw source reaches it', () => {
    const output = compile(`
      import { $read } from '@memoized-dom/data';
      export function App() {
        const boxes = [$read(Promise.resolve({ name: 'Ada' }))];
        return <p>{boxes.map((box) => box.name).join(',')}</p>;
      }`);

    expect(output).toMatch(/readSourceValue\(box\)/);
  });

  describe('mount', () => {
    // A component that waits, and a call this proof cannot see into. If something unknown
    // could run the component, that call could wait too, and every such call is guarded.
    const app = `import { $fetch } from '@memoized-dom/data';
      export function App() {
        const user = $fetch('/user');
        const label = String(Math.random());
        return <p>{user.name}{label}</p>;
      }`;

    it('does not count as unknown code running a component from another file', () => {
      const alone = compileModules({ './App.tsx': app })['./App.tsx']!;
      const mounted = compileModules({
        './App.tsx': app,
        './main.ts': `import { mount } from '@memoized-dom/runtime';
          import { App } from './App';
          mount('root', App);`,
      })['./App.tsx']!;

      expect(mounted).toBe(alone);
    });

    it('does not count as unknown code running a component from the same file', () => {
      const alone = compileModules({ './App.tsx': app })['./App.tsx']!;
      const mounted = compileModules({
        './App.tsx': `import { mount } from '@memoized-dom/runtime';
          ${app}
          mount('root', App);`,
      })['./App.tsx']!;

      expect(mounted.match(/whenSourceInputs|readSourceValue/g)).toEqual(alone.match(/whenSourceInputs|readSourceValue/g));
    });

    it('still counts a function of the same name from elsewhere as unknown code', () => {
      const alone = compileModules({ './App.tsx': app })['./App.tsx']!;
      const mounted = compileModules({
        './App.tsx': app,
        './main.ts': `import { mount } from 'some-other-package';
          import { App } from './App';
          mount('root', App);`,
      })['./App.tsx']!;

      expect(mounted).not.toBe(alone);
    });

    // A server build compiles the server entry with the components. Before, `app.ssr(App)` ran App
    // from unknown code, so App compiled with readiness on the server and without it in the
    // browser, and the server's HTML did not fit the browser's templates.
    const server = (setup: string) => compileModules({
      './App.tsx': app,
      './server.ts': `${setup}
        import { App } from './App';
        app.get('/api/user', () => ({ name: 'Ada' }));
        app.ssr(App);
        export default app;`,
    })['./App.tsx']!;

    it("does not count a server app's ssr(App) or its handlers as unknown code", () => {
      const alone = compileModules({ './App.tsx': app })['./App.tsx']!;

      expect(server(`import { serve } from '@memoized-dom/server'; const app = serve({});`)).toBe(alone);
      expect(server(`import { serve } from '@memoized-dom/server'; const app = serve({}).get('/', () => 'ok');`)).toBe(alone);
    });

    it('still counts the same calls on a value from code the proof cannot see', () => {
      const alone = compileModules({ './App.tsx': app })['./App.tsx']!;

      expect(server(`function serve() { return globalThis.server; } const app = serve();`)).not.toBe(alone);
      expect(server(`import { serve } from '@memoized-dom/server'; let app = serve({}); app = globalThis.server;`)).not.toBe(alone);
    });
  });

  describe('entries', () => {
    const helper = `export function shown(value) { return value + 1; }`;

    it('follows what the graph passes to an export that is not an entry', () => {
      const modules = {
        './helper.ts': helper,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          import { shown } from './helper';
          export function App() {
            const user = $fetch('/user');
            return <p>{user.name}{shown(1)}</p>;
          }`,
      };
      const everyExport = compileModules(modules)['./helper.ts']!;
      const fromEntry = compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!;

      expect(everyExport).toMatch(/readSourceValue\(value\)/);
      expect(fromEntry).not.toMatch(/readSourceValue/);
    });

    it('still sees a source the graph passes to that export', () => {
      const modules = {
        './helper.ts': helper,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          import { shown } from './helper';
          export function App() {
            const user = $fetch('/user');
            return <p>{shown(user)}</p>;
          }`,
      };
      expect(compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!).toMatch(/readSourceValue\(value\)/);
    });

    it('follows those calls through a barrel', () => {
      const modules = {
        './helper.ts': helper,
        './barrel.ts': `export * from './helper';`,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          import { shown } from './barrel';
          export function App() {
            const user = $fetch('/user');
            return <p>{shown(user)}</p>;
          }`,
      };
      expect(compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!).toMatch(/readSourceValue\(value\)/);
    });

    it.each([
      ['a named re-export', `export { shown } from './helper';`],
      ['a star re-export', `export * from './helper';`],
      ['an import exported again', `import { shown } from './helper'; export { shown };`],
    ])('counts an export the entry forwards through %s as used from outside', (_name, forwarding) => {
      const modules = {
        './helper.ts': helper,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          ${forwarding}
          export function App() { const user = $fetch('/user'); return <p>{user.name}</p>; }`,
      };
      expect(compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!).toMatch(/readSourceValue\(value\)/);
    });

    it.each([
      ['a namespace import', helper, `import * as helper from './helper';`, 'helper.shown(user)'],
      ['a dynamic import', helper, ``, `import('./helper').then((helper) => helper.shown(user)) && 1`],
      ['a captured default export', `function shown(value) { return value + 1; } export default shown;`, `import shown from './helper';`, 'shown(user)'],
      ['an anonymous default export', `export default (value) => value + 1;`, `import shown from './helper';`, 'shown(user)'],
    ])('keeps what it cannot follow by name: %s', (_name, source, imports, use) => {
      const modules = {
        './helper.ts': source,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          ${imports}
          export function App() { const user = $fetch('/user'); return <p>{${use}}</p>; }`,
      };
      expect(compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!).toMatch(/readSourceValue\(value\)/);
    });
  });

  it('assumes code outside the graph can create sources', () => {
    const output = compile(`
      import { $fetch } from '@memoized-dom/data';
      import { load } from 'some-library';
      export function App() {
        const user = $fetch('/user');
        const item = load();
        return <p>{user.name}{item.name}</p>;
      }`);

    expect(output).toMatch(/readSourceValue\(item\)/);
  });

  it('brings in nothing unknown through a stylesheet, unlike a library', () => {
    // Every `.auwla` file with a <style> imports its stylesheet. Before, that import made values
    // from unknown code possible sources across the whole app, so a component that shows only
    // markup got readiness code and the data package's internals.
    const files = (extra: string) => ({
      './main.ts': `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`,
      // The call is what a library's values could reach; a module of plain markup reads none.
      './Footer.tsx': `${extra}\nexport function Footer() { return <footer>{'Triaxis'.toUpperCase()}</footer>; }`,
      './App.tsx': `import { $fetch } from '@memoized-dom/data';
        import { Footer } from './Footer';
        export function App() {
          const items = $fetch('/items');
          return <main><p>{items.length}</p><Footer /></main>;
        }`,
    });
    const options = { entries: ['./main.ts'] };

    const styled = compileModules(files(`import './Footer.css';`), options)['./Footer.tsx']!;
    expect(styled).toContain(`import './Footer.css'`);
    expect(styled).not.toContain('@memoized-dom/data');

    const library = compileModules(files(`import 'some-library';`), options)['./Footer.tsx']!;
    expect(library).toContain('@memoized-dom/data/internal');
  });

  it("reads a component's closing tag as no call of its own", () => {
    // `</Panel>` names Panel again. Before, that reference counted as unknown code running Panel,
    // whose props read a source, so every call to unknown code (here `toUpperCase`) could wait.
    const files = (panel: string) => ({
      './main.ts': `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`,
      './Panel.tsx': 'export function Panel({ busy, children }) { return <section>{busy ? "Saving" : children}</section>; }',
      './App.tsx': `import { Panel } from './Panel';
        export function App() {
          const items = $fetch('/items');
          const shout = 'hi'.toUpperCase();
          return <main><h1>{shout}</h1>${panel}</main>;
        }`,
    });
    const options = { entries: ['./main.ts'] };

    const closed = compileModules(files('<Panel busy={items.length}><p>child</p></Panel>'), options)['./App.tsx']!;
    const selfClosed = compileModules(files('<Panel busy={items.length} children={<p>child</p>} />'), options)['./App.tsx']!;
    expect(selfClosed).toContain(`let shout = 'hi'.toUpperCase();`);
    expect(closed).toContain(`let shout = 'hi'.toUpperCase();`);
  });

  it('runs a form action on submit, never from unknown code inside a render', () => {
    // `$forms` calls its action from a submit. Before, an action awaiting a function that returns
    // a source counted as unknown code running a function that waits, so every call to unknown
    // code (here `toUpperCase`) could wait.
    const files = (form: string) => ({
      './main.ts': `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`,
      './App.tsx': `
        function save(name) { return $fetch('/save', { method: 'POST', body: { name } }); }
        export function App() {
          const items = $fetch('/items');
          const shout = 'hi'.toUpperCase();
          const form = ${form};
          return <main><h1>{shout}</h1><p>{items.length}</p><form onSubmit={form.submit} /></main>;
        }`,
    });
    const options = { entries: ['./main.ts'] };
    const action = `async (fields) => { const saved = await save(fields.get('name')); return saved; }`;

    for (const form of [`$forms(${action})`, `$forms({ action: ${action} })`]) {
      expect(compileModules(files(form), options)['./App.tsx']!).toContain(`let shout = 'hi'.toUpperCase();`);
    }
    // Handed to code outside the graph, the same action still counts.
    const handed = compileModules(files(`record(${action})`), options)['./App.tsx']!;
    expect(handed).not.toContain(`let shout = 'hi'.toUpperCase();`);
  });

  it('keeps a module of plain markup free of readiness once unknown values may hold a source', () => {
    // A source inside an object literal counts as reaching unknown code. Before, that made every
    // module in the app need readiness, even a footer that evaluates nothing.
    const files = (footer: string) => ({
      './main.ts': `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`,
      './Footer.tsx': `export function Footer() { return <footer>${footer}</footer>; }`,
      './App.tsx': `import { Footer } from './Footer';
        export function App() {
          const items = $fetch('/items');
          const rows = [{ count: items }];
          return <main><p>{rows.length}</p><Footer /></main>;
        }`,
    });
    const options = { entries: ['./main.ts'] };

    const plain = compileModules(files('<p class="mark">"Triaxis"</p>'), options)['./Footer.tsx']!;
    expect(plain).not.toContain('@memoized-dom/data');

    // A global could hold anything code outside the graph put there.
    const global = compileModules(files('<p>{location.host}</p>'), options)['./Footer.tsx']!;
    expect(global).toContain('@memoized-dom/data/internal');
  });

  it("brings in nothing unknown through a route's lazy page, unlike an authored import()", () => {
    // In a browser build a page imported only for its route loads with `import()`, whose namespace
    // goes straight to the router. Before, any `import()` made every value from unknown code a
    // possible source, so the handler's `event.preventDefault()` was wrapped in readiness.
    const files = (extra: string) => ({
      './main.ts': `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`,
      './Page.tsx': 'export function Page() { return <p>page</p>; }',
      './App.tsx': `import { Page } from './Page';
        export function App() {
          const items = $fetch('/items');
          function add(event) { event.preventDefault(); }
          ${extra}
          return <main><form onSubmit={add}><p>{items.length}</p></form><Page route="/page" /></main>;
        }`,
    });
    const options = { entries: ['./main.ts'], routedEnvironment: 'client' as const };

    const lazy = compileModules(files(''), options)['./App.tsx']!;
    expect(lazy).toContain('import("./Page.tsx")');
    expect(lazy).not.toMatch(/sourceBindingInput\(event/);

    const authored = compileModules(files("import('./Page').then((module) => record(module));"), options)['./App.tsx']!;
    expect(authored).toMatch(/sourceBindingInput\(event/);
  });

  it("sees the source a server function's facade returns", () => {
    // `server/generate.ts` writes these facades. Before, the internal creators counted as unknown
    // code, so a page or live function's result was a source only where something else in the
    // program made every unknown value one: a server's program showed its page as `[object Object]`.
    for (const creator of ['createPageSource', 'createStreamingSource']) {
      const output = compileModules({
        './main.ts': `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`,
        './board.ts': `import { ${creator} as __mmd_source } from '@memoized-dom/data/internal';
          export function getBoard() { return __mmd_source('/_fn/boards/getBoard', {}, 'live'); }`,
        './App.tsx': `import { getBoard } from './board';
          export function App() { const board = getBoard(); return <main>{board}</main>; }`,
      }, { entries: ['./main.ts'] })['./App.tsx']!;

      expect(output).toMatch(/readSourceValue\(board\)/);
    }
  });

  it('keeps every guard when eval is present', () => {
    const output = compile(`
      import { $fetch } from '@memoized-dom/data';
      export function App() {
        let count = 0;
        const user = $fetch('/user');
        eval('count = 1');
        return <p>{user.name}{count}</p>;
      }`);

    expect(output).toMatch(/readSourceValue\(count\)/);
  });
});
