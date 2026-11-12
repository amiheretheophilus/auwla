/**
 * Hot replacement: which modules accept their own update, the hot runtime's calls, and an edit
 * replacing a component in place while its parent keeps its state.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resetScheduler, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import { compileModules } from '../../pipeline';

const ACCEPT = 'import.meta.hot.accept(';
const HOT_IMPORT = 'import * as __mmd_hot from "@memoized-dom/runtime/hot";';

function compileHot(modules: Record<string, string>, entries = ['./main.tsx']): Record<string, string> {
  return compileModules(modules, { entries, hot: true });
}

const MAIN = `import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount(document.body, App);`;

it('a module exporting only components accepts its own update', () => {
  const output = compileHot({
    './main.tsx': MAIN,
    './App.tsx': `
      import { Card } from './Card';
      import Panel from './Panel';
      export type Props = { title: string };
      export function App() { return <main><Card /><Panel /></main>; }
    `,
    './Card.tsx': `export const Card = () => <p>card</p>;`,
    './Panel.tsx': `export default function Panel() { return <section>panel</section>; }`,
  });

  for (const path of ['./App.tsx', './Card.tsx', './Panel.tsx']) {
    expect(output[path]).toContain(HOT_IMPORT);
    expect(output[path]).toContain(ACCEPT);
  }
  // Keys are names, which an edit above the component does not move.
  expect(output['./Card.tsx']).toContain('"./Card.tsx#Card"');
});

it('the entry, and a module exporting anything else, let the update reach their importers', () => {
  const output = compileHot({
    './main.tsx': MAIN,
    './App.tsx': `
      import { Mixed, label } from './Mixed';
      import { Forwarded } from './Forward';
      import { Starred } from './Star';
      export function App() { return <main><Mixed />{label}<Forwarded /><Starred /></main>; }
    `,
    './Mixed.tsx': `export function Mixed() { return <p>m</p>; } export const label = 'x';`,
    './Forward.tsx': `export { Mixed as Forwarded } from './Mixed'; export function Local() { return <i />; }`,
    './Star.tsx': `export * from './Starred'; export function Own() { return <b />; }`,
    './Starred.tsx': `export function Starred() { return <u />; }`,
    './plain.ts': `export const value = 1;`,
  });

  expect(output['./main.tsx']).not.toContain(ACCEPT);
  expect(output['./Mixed.tsx']).not.toContain(ACCEPT);
  expect(output['./Forward.tsx']).not.toContain(ACCEPT);
  expect(output['./Star.tsx']).not.toContain(ACCEPT);
  // It still defines components, so the hot runtime sees them defined.
  expect(output['./Mixed.tsx']).toContain(HOT_IMPORT);
});

it('stops a module\'s previous effects where its module scope is made, not in a shared function', () => {
  const output = compileHot({
    './main.tsx': MAIN,
    './App.tsx': `import { count, start } from './store'; export function App() { start(); return <p>{count}</p>; }`,
    './store.ts': `
      export let count = 0;
      $effect(() => { console.log(count); });
      export function start() { $effect(() => { count++; }); }
    `,
  });
  const store = output['./store.ts']!;

  expect(store.match(/moduleEvaluating\("\.\/store\.ts"\)/g)).toHaveLength(1);
  expect(store.indexOf('moduleEvaluating')).toBeLessThan(store.indexOf('createEffectScope'));
  expect(store).not.toContain(ACCEPT);
});

it('leaves the output alone without the option', () => {
  const output = compileModules({ './main.tsx': MAIN, './App.tsx': `export function App() { return <p />; }` }, {
    entries: ['./main.tsx'],
  });

  expect(output['./App.tsx']).not.toContain('runtime/hot');
});

const applications: MountedApplication[] = [];
let sequence = 0;

afterEach(() => {
  for (const app of applications.splice(0)) app.unmount();
  resetScheduler();
});

/** Writes one build's modules to their own folder, as a dev server serves each edit at a new URL. */
function writeBuild(output: Record<string, string>): string {
  const directory = join(import.meta.dirname, '../../../tests/out/hot', `build-${sequence++}`);
  mkdirSync(directory, { recursive: true });
  for (const [path, code] of Object.entries(output)) writeFileSync(join(directory, path), code);
  return directory;
}

it('an edited component replaces its live instances, and its parent keeps its state', async () => {
  const app = `
    import { mount } from '@memoized-dom/runtime/testing';
    import { Label } from './Label';
    export function App() {
      let count = 0;
      return <main><button onClick={() => count++}>{count}</button><Label text="hi" /></main>;
    }
    export function start(host) { return mount(host, App); }
  `;
  const options = {
    entries: ['./App.tsx'], hot: true, runtimePath: '@memoized-dom/runtime/testing',
  } as const;
  const first = compileModules({
    './App.tsx': app,
    './Label.tsx': `export function Label({ text }) { return <b>first {text}</b>; }`,
  }, options);
  expect(first['./Label.tsx']).toContain(ACCEPT);

  setScheduler((run) => run());
  const before = writeBuild(first);
  const module = await import(pathToFileURL(join(before, 'App.tsx')).href);
  const host = document.createElement('div');
  document.body.append(host);
  applications.push(module.start(host));
  host.querySelector('button')!.click();
  expect(host.textContent).toBe('1first hi');

  // The dev server evaluates the edited module again, then its boundary accepts it.
  const second = compileModules({
    './App.tsx': app,
    './Label.tsx': `export function Label({ text }) { return <b>second {text}</b>; }`,
  }, options);
  expect(second['./App.tsx']).toBe(first['./App.tsx']);
  const after = writeBuild({ './Label.tsx': second['./Label.tsx']! });
  await import(pathToFileURL(join(after, 'Label.tsx')).href);
  const hot = await import('@memoized-dom/runtime/hot');
  hot.acceptComponents();

  expect(host.textContent).toBe('1second hi');
  host.querySelector('button')!.click();
  expect(host.textContent).toBe('2second hi');
  host.remove();
});
