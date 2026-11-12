/**
 * Lazy route chunks (`split.ts`): which imports a client build loads with their routes, and the
 * code that loads them. Behaviour, with the modules loaded at run time, is in
 * `tests/cases/routes.test.ts`.
 */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../../pipeline';
import type { CompileModulesOptions } from '../../options';

const CLIENT: CompileModulesOptions = { routedEnvironment: 'client' };

const PAGE = { './Profile.tsx': 'export function Profile() { return <h1>Profile</h1>; }' };

function compile(app: string, modules: Record<string, string> = PAGE, options: CompileModulesOptions = CLIENT) {
  return compileModules({ ...modules, './App.tsx': app }, options);
}

/** Whether the printed module still imports `./Profile` statically. */
const importsStatically = (code: string) => /import [^;]*from ['"]\.\/Profile(?:\.tsx)?['"]/.test(code);

describe('a component imported only for its routes loads with them', () => {
  const app = `import { Profile } from './Profile';
    export function App() { return <main><p route="/">Home</p><Profile route="/profile" /></main>; }`;

  it('drops the import, and reads the component from the router where it is shown', () => {
    const code = compile(app)['./App.tsx']!;
    expect(importsStatically(code)).toBe(false);
    expect(code).toContain('readRouteComponent("./Profile.tsx#Profile")');
  });

  it('gives the route\'s table entry the key and a loader that registers the export', () => {
    const code = compile(app)['./App.tsx']!;
    expect(code).toContain('componentKey: "./Profile.tsx#Profile"');
    expect(code).toContain('import("./Profile.tsx").then((m) => $registerRouteComponent("./Profile.tsx#Profile", m["Profile"]))');
  });

  it('loads the first route\'s module before anything mounts', () => {
    expect(compile(app)['./App.tsx']).toContain('prepareInitialRouteModules()');
  });

  it('keeps the import in a server build, which renders any route at once', () => {
    const code = compile(app, PAGE, { routedEnvironment: 'server' })['./App.tsx']!;
    expect(importsStatically(code)).toBe(true);
    expect(code).not.toContain('moduleLoader');
    expect(code).not.toContain('prepareInitialRouteModules');
  });

  it('keeps it when no environment is given', () => {
    expect(importsStatically(compile(app, PAGE, {})['./App.tsx']!)).toBe(true);
  });

  it('keeps the other names of the same declaration', () => {
    const code = compile(
      `import { Profile, title } from './Profile';
       export function App() { return <main><h1>{title}</h1><Profile route="/profile" /></main>; }`,
      { './Profile.tsx': 'export const title = "Hi"; export function Profile() { return <h1>Profile</h1>; }' },
    )['./App.tsx']!;
    // `title` loads the module with the page, so splitting `Profile` would only add a wait.
    expect(code).not.toContain('moduleLoader');
    expect(importsStatically(code)).toBe(true);
  });

  it('splits a default import by its default export', () => {
    const code = compile(
      `import Profile from './Profile';
       export function App() { return <main><Profile route="/profile" /></main>; }`,
      { './Profile.tsx': 'export default function Profile() { return <h1>Profile</h1>; }' },
    )['./App.tsx']!;
    expect(code).toContain('componentKey: "./Profile.tsx#default"');
    expect(code).toContain('m["default"]');
    expect(importsStatically(code)).toBe(false);
  });

  it('loads from the module that holds the table, wherever the import is written', () => {
    const output = compile(
      `import { Layout } from './pages/layout';
       export function App() { return <main><Layout /></main>; }`,
      {
        './pages/layout.tsx': `import { Profile } from './profile';
          export function Layout() { return <section><Profile route="/profile" /></section>; }`,
        './pages/profile.tsx': 'export function Profile() { return <h1>Profile</h1>; }',
      },
    );
    expect(output['./App.tsx']).toContain('import("./pages/profile.tsx")');
    expect(output['./pages/layout.tsx']).toContain('readRouteComponent("./pages/profile.tsx#Profile")');
    expect(output['./pages/layout.tsx']).not.toMatch(/from ['"]\.\/profile['"]/);
  });

  it('splits one module shown by two routes once, under one key', () => {
    const code = compile(`import { Profile } from './Profile';
      export function App() { return <main><Profile route="/a" /><Profile route="/b" /></main>; }`)['./App.tsx']!;
    expect(code.match(/componentKey: "\.\/Profile\.tsx#Profile"/g)).toHaveLength(2);
    expect(importsStatically(code)).toBe(false);
  });

  it('allows uses that are erased with the types', () => {
    const code = compile(`import { Profile } from './Profile';
      type Props = Parameters<typeof Profile>[0];
      export function App() { return <main><Profile route="/profile" /></main>; }`)['./App.tsx']!;
    expect(code).toContain('moduleLoader');
  });
});

describe('a component the page needs before its route is chosen stays in the page', () => {
  it.each([
    ['also shown without a route', `import { Profile } from './Profile';
      export function App() { return <main><Profile /><Profile route="/profile" /></main>; }`],
    ['also called', `import { Profile } from './Profile';
      export function App() { const view = Profile; return <main><Profile route="/profile" /></main>; }`],
    ['re-exported', `import { Profile } from './Profile'; export { Profile };
      export function App() { return <main><Profile route="/profile" /></main>; }`],
    ['imported as a namespace', `import * as pages from './Profile';
      export function App() { return <main><pages.Profile route="/profile" /></main>; }`],
    ['declared in the same module', `function Profile() { return <h1>Profile</h1>; }
      export function App() { return <main><Profile route="/profile" /></main>; }`],
    ['its name declared again inside', `import { Profile } from './Profile';
      export function App() { const show = (Profile) => Profile; return <main><Profile route="/profile" /></main>; }`],
  ])('%s', (_name, app) => {
    expect(compile(app)['./App.tsx']).not.toContain('moduleLoader');
  });

  it('imported by another module the page loads', () => {
    const output = compile(
      `import { Profile } from './Profile'; import { Nav } from './nav';
       export function App() { return <main><Nav /><Profile route="/profile" /></main>; }`,
      { ...PAGE, './nav.tsx': `import { Profile } from './Profile'; export function Nav() { return <nav><Profile /></nav>; }` },
    );
    expect(output['./App.tsx']).not.toContain('moduleLoader');
  });

  it('but not when that module itself loads with a route', () => {
    const output = compile(
      `import { Settings } from './settings';
       export function App() { return <main><Settings route="/settings" /></main>; }`,
      {
        ...PAGE,
        './settings.tsx': `import { Profile } from './Profile';
          export function Settings() { return <section><Profile route="/profile" /></section>; }`,
      },
    );
    expect(output['./App.tsx']).toContain('import("./settings.tsx")');
    expect(output['./App.tsx']).toContain('import("./Profile.tsx")');
  });
});
