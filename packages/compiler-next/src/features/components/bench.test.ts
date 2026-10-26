/** Correctness checks against the authored benchmark apps; no timing assertions. */
import { afterEach, expect, it, spyOn } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getExtensionStore, mount, registeredIds, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import * as runtime from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

const applications: MountedApplication[] = [];
const hosts: HTMLElement[] = [];
const NativeMap = globalThis.Map;
const nativeQueueMicrotask = globalThis.queueMicrotask.bind(globalThis);
let recoverySpy: ReturnType<typeof spyOn> | undefined;
let rowSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  recoverySpy?.mockRestore();
  recoverySpy = undefined;
  rowSpy?.mockRestore();
  rowSpy = undefined;
  globalThis.Map = NativeMap;
  for (const application of applications.splice(0)) {
    application.unmount();
  }
  clearCompiledApps();
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

function runImmediately(run: () => void): void {
  run();
}

/** Counts calls of every emitted `_update` function, when a fixture is counted. */
const updates = { count: 0 };
(globalThis as { __mmdUpdates?: typeof updates }).__mmdUpdates = updates;

async function fixture(directory: string, files: readonly string[], component: string, counted = false, optimize = true) {
  const root = join(import.meta.dirname, '../../../../../');
  const sources = Object.fromEntries(files.map((file) => {
    const path = `./bench/${directory}/${file}`;
    return [path, readFileSync(join(root, path), 'utf8')];
  }));
  const compiled = compileModules(sources, { runtimePath: '@memoized-dom/runtime/testing', optimize });
  const output = join(import.meta.dirname, '../../../tests/out/components-bench', directory,
    optimize ? 'optimized' : 'general', counted ? 'counted' : '');
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
  setScheduler(runImmediately);
  const application = mount(host, module[component]);
  applications.push(application);
  const click = (selector: string) => host.querySelector<HTMLElement>(selector)!.click();
  return { host, click };
}

it.each([
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
])('reuses row-matching maps during inline-row selection ($mode)', async ({ optimize }) => {
  const { host, click } = await fixture('octane/memoized-dom', ['App.tsx', 'model.ts'], 'OctaneBench', false, optimize);
  click('#run');
  const rows = [...host.querySelectorAll('tbody tr')];
  const matchingMaps = new Set<object>();
  globalThis.Map = class CountedMap<Key, Value> extends NativeMap<Key, Value> {
    override set(key: Key, value: Value): this {
      // Account only for renderer row identities. Mutation snapshots and other
      // runtime maps remain part of the workload, but are not this pass's work.
      if (typeof key === 'string' && key.startsWith('key=')) {
        matchingMaps.add(this);
      }
      return super.set(key, value);
    }
  };
  for (let index = 0; index < 4; index++) {
    rows[index]!.querySelector<HTMLElement>('td:nth-child(2) a')!.click();
    expect(rows[index]!.className).toBe('danger');
    if (index > 0) {
      expect(rows[index - 1]!.className).toBe('');
    }
  }
  globalThis.Map = NativeMap;
  expect(matchingMaps.size).toBe(optimize ? 0 : 4);
  expect(host.querySelector('tbody tr')).toBe(rows[0]!);
}, 30_000);

it.each([
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
])('updates only the component rows whose props changed ($mode)', async ({ optimize }) => {
  const { host } = await fixture('dom', ['App.tsx', 'data.ts'], 'BenchApp', true, optimize);
  const click = (label: string) => {
    [...host.querySelectorAll('button')].find((node) => node.textContent === label)!.click();
  };
  const runs = (action: () => void) => {
    updates.count = 0;
    action();
    return updates.count;
  };
  click('create1k');
  // The list owner updates once. Generally, a row component updates only when
  // its own item changed; optimized, `Row` is a leaf compiled into the owner's
  // row list (`optimize/row-lists.ts`), which updates its rows in that one pass.
  expect(runs(() => click('update'))).toBe(optimize ? 1 : 1 + 100);
  expect(runs(() => click('swap'))).toBe(1);
  expect(runs(() => click('remove'))).toBe(1);
  expect(runs(() => click('append1k'))).toBe(1);
  // Every row reads `selected === props.item.id`; the general path checks every
  // row component's class, the row list re-evaluates its rows in one owner pass.
  const rows = [...host.querySelectorAll('li')];
  expect(runs(() => rows[0]!.click())).toBe(optimize ? 1 : rows.length);
  expect(runs(() => rows[1]!.click())).toBe(optimize ? 1 : rows.length);
  expect(rows[0]!.className).toBe('');
  expect(rows[1]!.className).toBe('danger');
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

it.each([
  ['octane/memoized-dom', ['App.tsx', 'model.ts'], 'OctaneBench'],
  ...componentRowApps.map(([file, component]) => ['dom', [file, 'data.ts'], component] as const),
] as const)('routes benchmark selection without remapping rows: %s/%s', async (directory, files, component) => {
  let updates = 0, keys = 0;
  const create = runtime.createRowList;
  rowSpy = spyOn(runtime, 'createRowList').mockImplementation((anchor, owner, key, factory, path) =>
    create(anchor, owner, key === null ? null : (item, index) => { keys++; return key(item, index); }, (item, index) => {
      const entry = factory(item, index);
      const update = entry.update;
      entry.update = (item, index) => { updates++; update(item, index); };
      return entry;
    }, path));
  const { host, click } = await fixture(directory, files, component);
  if (component === 'OctaneBench') click('#run');
  else [...host.querySelectorAll('button')].find((button) => button.textContent === 'create1k')!.click();
  const rows = [...host.querySelectorAll<HTMLElement>('tbody tr, ul > li')];
  expect(rows).toHaveLength(1000);
  const select = (index: number) => {
    if (component === 'OctaneBench') rows[index]!.querySelector<HTMLElement>('td:nth-child(2) a')!.click();
    else rows[index]!.click();
  };
  updates = 0; keys = 0;
  select(0);
  expect(updates).toBe(1);
  expect(keys).toBe(0);
  updates = 0;
  select(999);
  expect(updates).toBe(2);
  expect(keys).toBe(0);
  expect(rows[0]!.className).toBe('');
  expect(rows[999]!.className).toBe('danger');
}, 30_000);

it.each([
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
])('bounds recovery scheduling during a 100-row edit in the authored fixture ($mode)', async ({ optimize }) => {
  const { host } = await fixture('dom', ['AppModuleDataComponent.tsx', 'data.ts'],
    'BenchModuleDataComponent', false, optimize);
  const click = (label: string) => {
    [...host.querySelectorAll('button')].find((button) => button.textContent === label)!.click();
  };
  click('create1k');
  await Promise.resolve();
  let queued = 0;
  recoverySpy = spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    queued++;
    nativeQueueMicrotask(callback);
  });
  click('update');
  recoverySpy.mockRestore();
  recoverySpy = undefined;
  expect(host.querySelectorAll('li')).toHaveLength(1000);
  expect(host.querySelector('li')!.textContent).toContain(' !!!');
  // Include every subsystem's recovery, without filtering runtime function
  // names. The budget is constant rather than one callback per edited row.
  expect(queued).toBeLessThan(10);
}, 30_000);

it.each([
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
])('registers only subscribing collectors in the component-row fixture ($mode)', async ({ optimize }) => {
  const { host } = await fixture('dom', ['AppModuleDataComponent.tsx', 'data.ts'],
    'BenchModuleDataComponent', false, optimize);
  const owners = getExtensionStore<Map<string, Set<unknown>>>('mmd:owned-computations', () => new Map());
  const collectorCount = () => [...owners.values()].reduce((count, collectors) => count + collectors.size, 0);
  const initial = collectorCount();
  const initialOwners = owners.size;
  const click = (label: string) => {
    [...host.querySelectorAll('button')].find((button) => button.textContent === label)!.click();
  };

  click('create1k');
  expect(host.querySelectorAll('li')).toHaveLength(1000);
  // The three row expressions are guarded by prop versions. Their collectors
  // discover no hidden reads, so they add no ownership sets or disposal visits.
  expect(collectorCount() - initial).toBe(0);
  expect(owners.size).toBe(initialOwners);
  click('update');
  expect(host.querySelector('li')!.textContent).toContain(' !!!');
  click('clear');
  expect(host.querySelectorAll('li')).toHaveLength(0);
  expect(collectorCount()).toBe(initial);
}, 30_000);

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
