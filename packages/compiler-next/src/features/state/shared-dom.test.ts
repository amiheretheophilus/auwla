/** Shared dependencies notify each mounted application through its own batch. */
import { expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime, setScheduler,
} from '@memoized-dom/runtime/testing';
import { compileModules } from '../../pipeline';

it.each([
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
])('releases a shared derivation\'s previous data after its lazy refresh ($mode)', async ({ mode, optimize }) => {
  const code = compileModules({ './App.tsx': `
    let data = [{ count: 0 }];
    const copy = [...data];
    export function remember() {
      const reference = new WeakRef(copy);
      data[0].count++;
      return reference;
    }
    export function replace() { data = []; return data.length; }
    export function App() { return <p>{copy.length}</p>; }
  ` }, { runtimePath: '@memoized-dom/runtime/testing', optimize })['./App.tsx']!;
  const directory = join(import.meta.dirname, '../../../tests/out/shared-native');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `retention-${mode}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  const reference = module.remember() as WeakRef<object>;
  expect(module.replace()).toBe(0);
  // Ordinary callbacks read held native values. Consuming the view is the
  // boundary that refreshes its derived binding before collection is checked.
  const runtime = createApplicationRuntime(`shared-retention-${mode}`, getActiveEnvironment());
  const view = runWithApplicationRuntime(runtime, () => module.App('retention', null)) as HTMLElement;
  expect(view.textContent).toBe('0');
  runtime.dispose();
  // Weak targets remain live for their creating job. Cross tasks before GC,
  // and allow bounded retries for conservative stack and weak processing.
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    if (reference.deref() === undefined) {
      break;
    }
  }
  expect(reference.deref()).toBeUndefined();
}, 15_000);

it('updates two applications sharing a module and releases a disposed consumer', async () => {
  const code = compileModules({ './App.tsx': `let count = 1; const twice = count * 2;
    export function inc() { count++; }
    export function App() { return <main><p>{count}:{twice}</p><button onClick={inc}>inc</button></main>; }`,
  }, { runtimePath: '@memoized-dom/runtime/testing' })['./App.tsx']!;
  const directory = join(import.meta.dirname, '../../../tests/out/shared-native');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'applications.js');
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  const first = createApplicationRuntime('first-shared', getActiveEnvironment());
  const second = createApplicationRuntime('second-shared', getActiveEnvironment());
  const mount = (runtime: typeof first) => runWithApplicationRuntime(runtime, () => {
    setScheduler((run) => run());
    return module.App('same-id', null) as HTMLElement;
  });
  const a = mount(first), b = mount(second);
  runWithApplicationRuntime(first, () => a.querySelector('button')!.click());
  await Promise.resolve();
  expect(a.querySelector('p')!.textContent).toBe('2:4');
  expect(b.querySelector('p')!.textContent).toBe('2:4');
  first.dispose();
  runWithApplicationRuntime(second, () => b.querySelector('button')!.click());
  await Promise.resolve();
  expect(a.querySelector('p')!.textContent).toBe('2:4');
  expect(b.querySelector('p')!.textContent).toBe('3:6');
  second.dispose();
});
