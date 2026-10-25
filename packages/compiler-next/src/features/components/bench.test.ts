/** Correctness checks against the authored benchmark apps; no timing assertions. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mount, registeredIds, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

const applications: MountedApplication[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const application of applications.splice(0)) {
    application.unmount();
  }
  clearCompiledApps();
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

/** Counts calls of every emitted `_update` function, when a fixture is counted. */
const updates = { count: 0 };
(globalThis as { __mmdUpdates?: typeof updates }).__mmdUpdates = updates;

async function fixture(directory: string, files: readonly string[], component: string, counted = false) {
  const root = join(import.meta.dirname, '../../../../../');
  const sources = Object.fromEntries(files.map((file) => {
    const path = `./bench/${directory}/${file}`;
    return [path, readFileSync(join(root, path), 'utf8')];
  }));
  const compiled = compileModules(sources, { runtimePath: '@memoized-dom/runtime/testing' });
  const output = join(import.meta.dirname, '../../../tests/out/components-bench', directory, counted ? 'counted' : '');
  mkdirSync(output, { recursive: true });
  for (const [path, source] of Object.entries(compiled)) {
    const code = counted
      ? source.replace(/function (_update\d*)\(\) \{/g, 'function $1() { globalThis.__mmdUpdates.count++;')
      : source;
    writeFileSync(join(output, basename(path)), code);
  }
  // The first file is the entry that exports `component`.
  const module = await import(pathToFileURL(join(output, files[0]!)).href);
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  setScheduler((run) => run());
  const application = mount(host, module[component]);
  applications.push(application);
  const click = (selector: string) => host.querySelector<HTMLElement>(selector)!.click();
  return { host, click };
}

it('updates only the component rows whose props changed', async () => {
  const { host } = await fixture('dom', ['App.tsx', 'data.ts'], 'BenchApp', true);
  const click = (label: string) => {
    [...host.querySelectorAll('button')].find((node) => node.textContent === label)!.click();
  };
  const runs = (action: () => void) => {
    updates.count = 0;
    action();
    return updates.count;
  };
  click('create1k');
  // The list owner updates once; a row updates only when its own item changed.
  expect(runs(() => click('update'))).toBe(1 + 100);
  expect(runs(() => click('swap'))).toBe(1);
  expect(runs(() => click('remove'))).toBe(1);
  expect(runs(() => click('append1k'))).toBe(1);
  // Every row reads `selected`, so each row's class is checked.
  const rows = host.querySelectorAll('li').length;
  expect(runs(() => host.querySelector<HTMLElement>('li')!.click())).toBe(rows);
}, 30_000);

it('runs the Octane inline-row fixture through its synchronous creation/update/reorder/removal path', async () => {
  const { host, click } = await fixture('octane/memoized-dom', ['App.tsx', 'model.ts'], 'OctaneBench');
  click('#run');
  const rows = [...host.querySelectorAll('tbody tr')];
  expect(rows).toHaveLength(1000);
  const first = rows[0]!;
  const label = first.children[1]!.textContent;
  click('#update');
  expect(host.querySelector('tbody tr')).toBe(first);
  expect(first.children[1]!.textContent).toBe(label + ' !!!');
  click('#swaprows');
  expect(host.querySelectorAll('tbody tr')[1]).toBe(rows[998]);
  click('#reverse');
  expect(host.querySelectorAll('tbody tr')[999]).toBe(first);
  first.querySelector<HTMLElement>('td:nth-child(2) a')!.click();
  expect(first.className).toBe('danger');
  first.querySelector<HTMLElement>('td:nth-child(3) a')!.click();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(999);
  expect(first.isConnected).toBe(false);
  click('#clear');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
}, 30_000);

// Every component-row placement the DOM suite times (`bench/dom/state-placement-browser.ts`).
const componentRowApps = [
  ['App.tsx', 'BenchApp'],
  ['AppOwned.tsx', 'BenchAppOwned'],
  ['AppModuleDataComponent.tsx', 'BenchModuleDataComponent'],
  ['AppModuleSelectionComponent.tsx', 'BenchModuleSelectionComponent'],
] as const;

it.each(componentRowApps)('runs the component-row benchmark %s with retained rows and complete disposal', async (file, component) => {
  const { host } = await fixture('dom', [file, 'data.ts'], component);
  const click = (label: string) => {
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent === label)!;
    button.click();
  };
  click('create1k');
  const rows = [...host.querySelectorAll('li')];
  expect(rows).toHaveLength(1000);
  expect(rows.filter((row) => row.className !== '')).toHaveLength(0);
  expect(new Set(rows.map((row) => row.textContent!.split(':')[0])).size).toBe(1000);
  const first = rows[0]!;
  const label = first.textContent;
  click('update');
  expect(host.querySelector('li')).toBe(first);
  expect(first.textContent).toBe(label + ' !!!');
  click('swap');
  expect(host.querySelectorAll('li')[1]).toBe(rows[998]);
  click('reverse');
  expect(host.querySelectorAll('li')[999]).toBe(first);
  first.click();
  expect(first.className).toBe('danger');
  click('clear');
  expect(host.querySelectorAll('li')).toHaveLength(0);
  expect(registeredIds()).toHaveLength(1);
}, 30_000);
