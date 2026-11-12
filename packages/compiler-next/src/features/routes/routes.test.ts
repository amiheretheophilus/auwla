/**
 * Route lowering on its own (`features/routes/`): the code it gives a module, and the mistakes it
 * reports. Behaviour is compared with the reference in `tests/cases/routes.test.ts`.
 */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../../pipeline';

const compile = (source: string, modules: Record<string, string> = {}) => compileModules({ ...modules, './App.tsx': source }, {});

describe('what a program with routes compiles to', () => {
  it('installs one route table, in the module of the component nothing calls', () => {
    const output = compile(
      `import { Docs } from './docs'; export function App() { return <main route="/"><Docs /></main>; }`,
      { './docs.tsx': `export function Docs() { return <p route="/intro">Intro</p>; }` },
    );
    expect(output['./App.tsx']!.match(/installRouteTable\(/g)).toHaveLength(1);
    expect(output['./docs.tsx']).not.toContain('installRouteTable(');
    // The nested route is an instance under the outer one.
    expect(output['./App.tsx']).toContain('fullPattern: "/intro"');
  });

  it('knows a component\'s only route context, so it passes none', () => {
    const output = compile(`
      function Docs() { return <p route="/intro">Intro</p>; }
      export function App() { return <main><section route="/docs"><Docs /></section></main>; }`)['./App.tsx']!;
    expect(output).not.toContain('route:context');
    expect(output).toContain('fullPattern: "/docs/intro"');
  });

  it('passes the context to a component rendered in several', () => {
    const output = compile(`
      function Tabs() { return <b route="/x">X</b>; }
      export function App() { return <main><i route="/a"><Tabs /></i><i route="/b"><Tabs /></i></main>; }`)['./App.tsx']!;
    expect(output).toContain('route:context');
    expect(output).toContain('fullPattern: "/a/x"');
    expect(output).toContain('fullPattern: "/b/x"');
  });

  it('turns route-to into an href, and leaves no route attributes', () => {
    const output = compile(`export function App() { return <main><p route="/about">A</p><a route-to="/about">About</a></main>; }`)['./App.tsx']!;
    expect(output).toContain('"/about"');
    expect(output).not.toMatch(/route-to|"route"/);
  });
});

describe('route mistakes are compile errors', () => {
  it.each([
    ['a dynamic pattern', 'export function App() { let p = "/"; return <main route={p} />; }', /static string beginning with \//],
    ['a pattern without a leading slash', 'export function App() { return <main route="about" />; }', /must begin with '\/'/],
    ['a query in a pattern', 'export function App() { return <main route="/a?b" />; }', /query or hash/],
    ['a wildcard that is not last', 'export function App() { return <main route="/*/a" />; }', /wildcard must be terminal/],
    ['a parameter twice', 'export function App() { return <main route="/:id/:id" />; }', /duplicate route parameter 'id'/],
    ['a route outside a component', 'const view = <main route="/" />;', /inside a component/],
    ['a keyed route element', 'export function App() { return <main route="/" key="k" />; }', /keyed by its route/],
    ['two siblings with one pattern', 'export function App() { return <main><p route="/" /><p route="/" /></main>; }', /ambiguous routes/],
    ['patterns that differ only by a parameter name', 'export function App() { return <main><p route="/a/:x" /><p route="/a/:y" /></main>; }', /ambiguous routes/],
    ['a child of a catch-all', 'export function App() { return <main route="/*"><p route="/a" /></main>; }', /catch-all route '\/\*' cannot have child routes/],
    ['a child reusing a parameter', 'export function App() { return <main route="/:id"><p route="/:id" /></main>; }', /duplicate route parameter 'id'/],
    ['a link to no route', 'export function App() { return <main route="/"><a route-to="/missing" /></main>; }', /undeclared route '\/missing'/],
    ['a string link to a route with params', 'export function App() { return <main route="/:id"><a route-to="/:id" /></main>; }', /requires params \{ id \}; use the object form/],
    ['a link without its params', 'export function App() { return <main route="/:id"><a route-to={{ path: "/:id" }} /></main>; }', /requires params \{ id \}/],
    ['a link with the wrong params', 'export function App() { return <main route="/:id"><a route-to={{ path: "/:id", params: { wrong: 1 } }} /></main>; }', /missing id; unknown wrong/],
    ['a link with a parameter twice', 'export function App() { return <main route="/:id"><a route-to={{ path: "/:id", params: { id: 1, id: 2 } }} /></main>; }', /duplicate 'id'/],
    ['a catch-all link without its rest', 'export function App() { return <main route="/*"><a route-to={{ path: "/*", params: {} }} /></main>; }', /missing \*/],
    ['a link with an unknown field', 'export function App() { return <main route="/"><a route-to={{ path: "/", replace: true }} /></main>; }', /does not support 'replace'/],
    ['a link with a dynamic path', 'export function App() { let p = "/"; return <main route="/"><a route-to={{ path: p }} /></main>; }', /static string 'path'/],
    ['a link on a button', 'export function App() { return <main route="/"><button route-to="/" /></main>; }', /route-to requires an anchor/],
    ['a link on a component', 'function Link() { return <a />; } export function App() { return <main route="/"><Link route-to="/" /></main>; }', /intrinsic elements/],
    ['a link with an href', 'export function App() { return <main route="/"><a href="/" route-to="/" /></main>; }', /must not also declare href/],
    ['a link with a spread', 'export function App() { const p = {}; return <main route="/"><a {...p} route-to="/" /></main>; }', /JSX prop spreads/],
  ])('%s', (_name, source, message) => {
    expect(() => compile(source)).toThrow(message);
  });

  it('a parameter a component\'s route context already declares', () => {
    expect(() => compile(
      `import { Detail } from './Detail'; export function App() { return <Detail route="/:id" />; }`,
      { './Detail.tsx': `export function Detail() { return <p route="/:id">Detail</p>; }` },
    )).toThrow("duplicate route parameter 'id'");
  });

  it('a route below a component called at a catch-all', () => {
    expect(() => compile(
      `import { Detail } from './Detail'; export function App() { return <Detail route="/*" />; }`,
      { './Detail.tsx': `export function Detail() { return <p route="/">Detail</p>; }` },
    )).toThrow(/catch-all route .* cannot have child routes/);
  });

  it('a component that renders routes and itself', () => {
    expect(() => compile(`
      function Tree() { return <ul><li route="/leaf">leaf</li><Tree /></ul>; }
      export function App() { return <Tree />; }`)).toThrow(/cannot render itself/);
  });

  it('a component in several contexts whose props are an array pattern', () => {
    expect(() => compile(`
      function Tabs([first]) { return <b route="/x">{first}</b>; }
      export function App() { return <main><i route="/a"><Tabs /></i><i route="/b"><Tabs /></i></main>; }`)).toThrow(/name or an object pattern/);
  });
});

describe('$routed preparations', () => {
  const page = (body: string) => `export function Page() { ${body} return <p>{page.title}</p>; }`;
  const routedApp = (body: string) => `${page(body)} function App() { return <Page route="/admin/:section" />; }`;

  it('registers the callback, reads the prepared value, and lists it on its route', () => {
    const output = compile(routedApp('const page = $routed(({ params }) => ({ title: params.section }));'))['./App.tsx']!;
    expect(output).toContain('registerRoutedPreparation');
    expect(output).toContain('readRoutedPreparation("./App.tsx#routed:Page:0")');
    expect(output).toContain('preparations: ["./App.tsx#routed:Page:0"]');
  });

  it('attaches through an imported route component', () => {
    const output = compile(
      `import { ReportPage } from './ReportPage'; export function App() { return <ReportPage route="/reports/:reportId" />; }`,
      { './ReportPage.tsx': `export function ReportPage() { const page = $routed(({ params }) => ({ id: params.reportId })); return <p>{page.id}</p>; }` },
    );
    expect(output['./App.tsx']).toContain('preparations: ["./ReportPage.tsx#routed:ReportPage:0"]');
  });

  it('drops a server-backed body and its #server import from a client build, and keeps it for a server', () => {
    const source = `import { reports } from '#server/reports';
      ${routedApp('const page = $routed(({ params, services }) => services.admin.load(params.section, reports));')}`;
    const client = compileModules({ './App.tsx': source }, { routedEnvironment: 'client' })['./App.tsx']!;
    expect(client).toContain('server: true');
    expect(client).not.toContain('services.admin.load');
    expect(client).not.toContain('#server/reports');
    expect(client).toMatch(/await [^;]*\$prepareInitialRoute\(\)/);
    const server = compileModules({ './App.tsx': source }, { routedEnvironment: 'server' })['./App.tsx']!;
    expect(server).toContain('services.admin.load');
    expect(server).not.toContain('prepareInitialRoute');
  });

  it('settles sources made inside a callback where they are made', () => {
    const output = compile(routedApp(`const page = $routed(({ routeState }) => {
      const result = $fetch('/api/items');
      routeState.items = result.map((item) => item.name);
      return { title: routeState.items.join() };
    });`))['./App.tsx']!;
    // Later stages compile the callback's body like any function's, so only the lowering's
    // shape is checked: an async callback given `read`, wrapped, with the settler.
    expect(output).toContain('withRoutedSources(async ({ routeState }, _routedRead)');
    expect(output).toMatch(/await [^;]*_routedRead\)\([^;]*\$fetch\('\/api\/items'\)/);
    expect(output).toContain('settle: $settleRoutedValue');
  });

  it('compiles a preparation of a component compiled on its own', () => {
    expect(() => compile(page('const page = $routed(({ params }) => params.id);'))).not.toThrow();
  });

  it.each([
    ['at module scope', `const page = $routed(({ params }) => params.id); export function App() { return <p route="/">{page}</p>; }`, /declared directly in a component/],
    ['inside a nested callback', routedApp('const run = () => $routed(() => 1); const page = { title: "" };'), /declared directly in a component/],
    ['assigned to a let', routedApp('let page = $routed(({ params }) => params.id);'), /component-local const binding/],
    ['with a callback by name', routedApp('const load = () => 1; const page = $routed(load);'), /inline preparation callback/],
    ['with a context rest', routedApp('const page = $routed(({ params, ...rest }) => params.id);'), /does not support a rest binding/],
    ['with two context objects', routedApp('const page = $routed((a, b) => 1);'), /one destructured context object/],
    ['capturing the instance', `export function Page(props) { const page = $routed(({ params }) => props.tenant + params.id); return <p>{page}</p>; }
      function App() { return <Page route="/:id" />; }`, /cannot capture component-instance binding 'props'/],
    ['in a component no route shows', `export function Page() { const page = $routed(() => ({ title: 'x' })); return <p>{page.title}</p>; }
      export function App() { return <main route="/"><Page /></main>; }`, /\$routed in component 'Page' is never prepared/],
  ])('$routed %s is an error', (_name, source, message) => {
    expect(() => compile(source)).toThrow(message);
  });

  it('a preparation no route runs, in an application that mounts', () => {
    expect(() => compileModules({
      './main.ts': `import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount('root', App);`,
      './App.tsx': `export function App() { const page = $routed(({ services }) => services.reports.load()); return <main>{page.title}</main>; }`,
    })).toThrow(/\$routed in component 'App' is never prepared/);
  });
});
