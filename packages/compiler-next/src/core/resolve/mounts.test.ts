/**
 * `mount(...)` in the root component's own file (`mounts.ts`): left out of a server build, run
 * once under hot replacement so the file accepts its own edits, and rendered at build time when the
 * page cannot change, with or without an export.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mountOnce, resetScheduler, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import { compileModules, compileModulesDetailed } from '../../pipeline';
import type { ProjectHost } from '../../project/host';
import { createApplication } from '../../server/application';

const APP = `
import { mount } from '@memoized-dom/runtime';
export function App() {
  let count = 0;
  return <main><button onClick={() => count++}>{count}</button></main>;
}
mount('root', App);
`;

it('stays as written without hot replacement, and runs once with it', () => {
  const plain = compileModules({ './App.tsx': APP }, { entries: ['./App.tsx'] })['./App.tsx']!;
  expect(plain).toContain("mount('root', App)");
  expect(plain).not.toContain('mountOnce');

  const hot = compileModules({ './App.tsx': APP }, { entries: ['./App.tsx'], hot: true })['./App.tsx']!;
  expect(hot).toContain('mountOnce("./App.tsx#mount0", () => mount(\'root\', App))');
  // The file holds a component and its own mount: it accepts its edits.
  expect(hot).toContain('import.meta.hot.accept(');
});

it('is left out of a server build, which imports the component to render it', () => {
  const server = compileModules({ './App.tsx': APP }, { entries: ['./App.tsx'], routedEnvironment: 'server' })['./App.tsx']!;
  expect(server).not.toMatch(/\bmount\(/);
  expect(server).toContain('void 0');
  expect(server).toContain('export function App(');
});

it('keeps a mount inside a function as it was: that file still reloads the page when edited', () => {
  const source = `import { mount } from '@memoized-dom/runtime';
    export function App() { return <p>app</p>; }
    export function start() { return mount('root', App); }`;
  const hot = compileModules({ './App.tsx': source }, { entries: ['./App.tsx'], hot: true })['./App.tsx']!;
  expect(hot).not.toContain('mountOnce');
  expect(hot).not.toContain('import.meta.hot.accept(');
});

it('renders a page that cannot change at build time, from its own file, exported or not', () => {
  for (const declaration of ['export function App()', 'function App()']) {
    const result = compileModulesDetailed({
      './App.tsx': `import { mount } from '@memoized-dom/runtime';
        ${declaration} { const names = ['Ada', 'Lin']; return <ul>{names.map((name) => <li>{name}</li>)}</ul>; }
        mount('root', App);`,
    }, { entries: ['./App.tsx'] });
    expect(result.initialRender).toEqual({ kind: 'html', html: '<ul><li>Ada</li><li>Lin</li></ul>', target: 'root', mountModuleId: './App.tsx' });
  }
});

it('serves as the application entry: the browser adopts the page, and the server renders it', async () => {
  const files: Record<string, string> = {
    './src/App.tsx': APP,
    './server.ts': `import { createDefine, serve } from '@memoized-dom/server';
      import { App } from './src/App';
      const app = serve({ define: createDefine() });
      app.ssr(App);
      export default app;`,
  };
  const host: ProjectHost = { readFile: (path) => files[path], list: () => [] };
  const build = await createApplication({ client: './src/App.tsx', server: { entry: './server.ts' }, host }).build();
  if (!build.client.ok || build.server?.ok !== true) throw new Error('the application did not build');
  const client = build.client.output['./src/App.tsx']!;
  expect(client).toContain("mount('root', App)");
  expect(client).toContain("import '@memoized-dom/runtime/hydrate'");
  expect(build.server.output['./src/App.tsx']).not.toMatch(/\bmount\(/);
});

const applications: MountedApplication[] = [];
let sequence = 0;
afterEach(() => {
  for (const app of applications.splice(0)) app.unmount();
  resetScheduler();
  document.body.innerHTML = '';
});

/** One build's modules in their own folder, as a dev server serves each edit at a new URL. */
function writeBuild(output: Record<string, string>): string {
  const directory = join(import.meta.dirname, '../../../tests/out/entry', `build-${sequence++}`);
  mkdirSync(directory, { recursive: true });
  for (const [path, code] of Object.entries(output)) writeFileSync(join(directory, path), code);
  return directory;
}

it('replaces its own component in place when edited, without mounting a second app', async () => {
  // Its own module name, so its component's key (`./Root.tsx#Root`) meets no other test's.
  const app = (label: string) => `
    import { mount } from '@memoized-dom/runtime/testing';
    export function Root() {
      let count = 0;
      return <main><button onClick={() => count++}>{count}</button><b>${label}</b></main>;
    }
    mount('root', Root);
  `;
  const options = { entries: ['./Root.tsx'], hot: true, runtimePath: '@memoized-dom/runtime/testing' } as const;

  setScheduler((run) => run());
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root')!;
  await import(pathToFileURL(join(writeBuild(compileModules({ './Root.tsx': app('first') }, options)), 'Root.tsx')).href);
  // The application the module's mount started: `mountOnce` returns it again, for unmounting after.
  applications.push(mountOnce('./Root.tsx#mount0', () => { throw new Error('the module did not mount'); }));
  root.querySelector('button')!.click();
  expect(root.textContent).toBe('1first');

  // The dev server evaluates the edited file again: its mount returns the application already
  // on the page, and the hot runtime replaces the component in it. The edited component's own
  // state starts again, as with any edited component (`wiki/compiler/project.md`, "Hot
  // replacement"); its children and the rest of the page would keep theirs.
  const edited = compileModules({ './Root.tsx': app('second') }, options);
  await import(pathToFileURL(join(writeBuild(edited), 'Root.tsx')).href);
  const hot = await import('@memoized-dom/runtime/hot');
  hot.acceptComponents();

  expect(root.querySelectorAll('main')).toHaveLength(1);
  expect(root.textContent).toBe('0second');
  root.querySelector('button')!.click();
  expect(root.textContent).toBe('1second');
});
