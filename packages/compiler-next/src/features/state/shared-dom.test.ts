/** Shared dependencies notify each mounted application through its own batch. */
import { expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime, setScheduler,
} from '@memoized-dom/runtime/testing';
import { compileModules } from '../../pipeline';

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
