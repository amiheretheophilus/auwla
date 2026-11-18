/** Shared dependencies notify each mounted application through its own batch. */
import { expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime, setScheduler,
} from '@memoized-dom/runtime/testing';
import { compileModules } from '../../pipeline';
import { findAll, is } from 'yuku-ast';
import { parse } from 'yuku-parser';

/** Statements that follow a `return` or `throw` in the same block, which can never run. */
function unreachable(code: string): string[] {
  const { program } = parse(code, { lang: 'js', sourceType: 'module' });
  const found: string[] = [];
  for (const block of findAll(program, ['BlockStatement', 'Program'])) {
    const body = (block as { body: { type: string; start: number; end: number }[] }).body;
    const end = body.findIndex((statement) => is.ReturnStatement(statement as never) || is.ThrowStatement(statement as never));
    if (end >= 0 && end < body.length - 1) found.push(code.slice(body[end + 1]!.start, body[end + 1]!.end));
  }
  return found;
}

it('declares the readiness a module waits on when no module state owns it', () => {
  // `make()` comes from outside the graph and a component uses a source, so `app` may hold one
  // (`features/sources/reach.ts`) and `app.run(App)` is a builder step at the module's top level.
  // Without module state, nothing else declared that step's storage (`core/emit/shared.ts`).
  const entry = compileModules({
    './entry.ts': `import { make } from 'some-host';\nimport { App } from './App';\nconst app = make();\napp.run(App);\nexport default app;\n`,
    './App.tsx': `export function App() { const value = $fetch('/value'); return <p>{value}</p>; }\n`,
  })['./entry.ts']!;
  const used = new Set(entry.match(/\b_source(?:Step|Binding)\d*\b/g));
  expect(used.size).toBeGreaterThan(0);
  for (const name of used) expect(entry).toMatch(new RegExp(`\\bconst ${name} = `));
});

it.each([true, false])('completes a shared frame that ends in return only through the return (optimize %p)', (optimize) => {
  // An effect reading a source, whose local its cleanup reads again, gets a shared frame (found in
  // the JSX+ team example's Person page). Its last statement returns, so nothing may follow it:
  // browsers warn "unreachable code after return statement".
  const code = compileModules({ './App.tsx': `
    export function App() {
      const member = $fetch('/api/member');
      $effect(() => {
        const previous = document.title;
        document.title = member.name;
        return () => { document.title = previous; };
      });
      return <p>{member.name}</p>;
    }
  ` }, { runtimePath: '@memoized-dom/runtime/testing', optimize })['./App.tsx']!;
  expect(code).toContain('_completeShared');
  expect(unreachable(code)).toEqual([]);
});

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
