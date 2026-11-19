/**
 * Stale checks: which derived values a component registers, and the runtime reporting one that an
 * edit the compiler could not see left out of date, while a correct page and a value that reads
 * chance stay quiet.
 */
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resetScheduler, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import { compileModules } from '../../pipeline';

const OPTIONS = { entries: ['./App.tsx'], staleChecks: true, runtimePath: '@memoized-dom/runtime/testing' } as const;

it('registers the derived values computed from their initializer alone', () => {
  const output = compileModules({
    './App.tsx': `
      export function App() {
        let rows = [{ id: 1, done: false }];
        let count = 0;
        const open = rows.filter((row) => !row.done);
        let edited = rows.map((row) => row.id);
        let taken = count * 2;
        const once = { id: count++, rows };
        function add() { edited.push(9); taken = 0; rows = []; }
        return <main onClick={add}>{open.length}{edited.length}{taken}{once.id}</main>;
      }
    `,
  }, OPTIONS)['./App.tsx']!;
  const call = output.slice(output.indexOf('watchStale('));

  expect(call).toContain('name: "open", inputs: ["rows"], read: () => open, compute: () => (rows.filter((row) => !row.done))');
  // Edited, reassigned, or repeating a write when computed again.
  expect(call).not.toContain('"edited"');
  expect(call).not.toContain('"taken"');
  expect(call).not.toContain('"once"');
});

it('leaves the output alone without the option, and on a server', () => {
  const source = { './App.tsx': `export function App() { let n = 0; const d = n * 2; return <p onClick={() => n++}>{d}</p>; }` };

  expect(compileModules(source, { entries: ['./App.tsx'] })['./App.tsx']).not.toContain('watchStale');
  expect(compileModules(source, { entries: ['./App.tsx'], staleChecks: true, routedEnvironment: 'server' })['./App.tsx'])
    .not.toContain('watchStale');
  // A dev server's build has them.
  expect(compileModules(source, { entries: ['./App.tsx'], hot: true })['./App.tsx']).toContain('watchStale');
});

const applications: MountedApplication[] = [];
const warnings: string[] = [];
const warn = console.warn;
let sequence = 0;

beforeEach(() => {
  console.warn = (message: unknown) => { warnings.push(String(message)); };
});

afterEach(() => {
  for (const app of applications.splice(0)) app.unmount();
  resetScheduler();
  console.warn = warn;
  warnings.length = 0;
});

/**
 * Mounts `app` from its own folder, beside `outside.js`: plain code the compiler never sees, which
 * keeps what it is given and edits it later.
 */
async function mountApp(app: string): Promise<HTMLElement> {
  const directory = join(import.meta.dirname, '../../../tests/out/stale', `build-${sequence++}`);
  mkdirSync(directory, { recursive: true });
  const output = compileModules({ './App.tsx': app }, OPTIONS);
  writeFileSync(join(directory, 'App.tsx'), output['./App.tsx']!);
  writeFileSync(join(directory, 'outside.js'), `
    let kept = null;
    export function keep(value) { kept = value; }
    export function editKept() { kept[0].done = true; }
  `);
  setScheduler((run) => run());
  const module = await import(pathToFileURL(join(directory, 'App.tsx')).href);
  const host = document.createElement('div');
  document.body.append(host);
  applications.push(module.start(host));
  return host;
}

/** Past the check after a commit, and the second look that confirms it. */
function checksDone(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

it('reports a derived value an unseen edit left out of date', async () => {
  const host = await mountApp(`
    import { mount } from '@memoized-dom/runtime/testing';
    import { keep, editKept } from './outside.js';
    export function App() {
      const rows = [{ id: 1, done: false }, { id: 2, done: false }];
      let clicks = 0;
      keep(rows);
      const open = rows.filter((row) => !row.done);
      return <main><button onClick={() => { editKept(); clicks++; }}>{clicks}</button><p>{open.length}</p></main>;
    }
    export function start(host) { return mount(host, App); }
  `);

  host.querySelector('button')!.click();
  expect(host.querySelector('p')!.textContent).toBe('2');
  await checksDone();

  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('`open` in App (./App.tsx) is out of date.');
  expect(warnings[0]).toContain('It holds 2 items, but computing it again gives 1 item.');
  expect(warnings[0]).toContain('Nothing it reads (`rows`) reported a change');
  host.remove();
});

it('stays quiet when every edit is seen, and for a value that reads chance', async () => {
  const host = await mountApp(`
    import { mount } from '@memoized-dom/runtime/testing';
    export function App() {
      const rows = [{ id: 1, done: false }, { id: 2, done: false }];
      let clicks = 0;
      const open = rows.filter((row) => !row.done);
      const lucky = Math.random() + clicks;
      return <main><button onClick={() => { rows[0].done = true; clicks++; }}>{clicks}</button><p>{open.length}</p><i>{lucky}</i></main>;
    }
    export function start(host) { return mount(host, App); }
  `);

  host.querySelector('button')!.click();
  expect(host.querySelector('p')!.textContent).toBe('1');
  await checksDone();

  expect(warnings).toEqual([]);
  host.remove();
});
