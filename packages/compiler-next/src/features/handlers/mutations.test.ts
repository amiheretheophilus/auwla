import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setScheduler } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

let sequence = 0;
afterEach(clearCompiledApps);

it('observes descriptor and prototype edits without invoking an unused getter', async () => {
  const { root, module } = await compile(`const item = Object.create({ count: 1 });
    Object.defineProperty(item, 'unused', { get() { throw Error('unused'); } });`,
    `Object.setPrototypeOf(item, { count: 3 });
     Object.defineProperty(item, 'other', { value: 7, configurable: true });
     Reflect.deleteProperty(item, 'other');`);
  root.querySelector('button')!.click();
  expect(root.querySelector('p')!.textContent).toBe('3:-');
  expect(module.log).toEqual([]);
});

it('observes an imported value passed to an unknown call, but not to a framework call', () => {
  const output = compileModules({
    './App.tsx': 'export const items = []; export function App() { return <p>{items.length}</p>; }',
    './main.ts': `import { mount } from '@memoized-dom/runtime';
      import { App, items } from './App';
      record(items);
      mount('root', App);`,
  });

  expect(output['./main.ts']).toMatch(/observeMutation\(\[\(\) => items\]/);
  expect(output['./main.ts']).not.toMatch(/observeMutation\(\[\(\) => App\]/);
});

async function compile(body: string, handlers: string) {
  const code = compileModules({ './App.tsx': `export const log = []; export let run;
    export function App() { ${body}
      run = () => { ${handlers} };
      return <main><p>{item.count}:{item.other ?? '-'}</p><button onClick={run}>run</button></main>;
    }` }, { runtimePath: '@memoized-dom/runtime/testing' })['./App.tsx']!;
  const directory = join(import.meta.dirname, '../../../tests/out/mutation-unit');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  const root = module.App('mutations', null) as HTMLElement;
  return { root, module };
}

it('does not make an effect depend on state it only edits', async () => {
  // The effect pushes to `log` through a helper; a click elsewhere pushes again. Reading `log` to
  // run `log.push` is not a read of it, so the click must not run the effect again.
  const code = compileModules({ './App.tsx': `export const log = [];
    function note(event) { log.push(event); }
    function Watcher() {
      $effect(() => { countRun(); note('watched'); });
      return <p>watching</p>;
    }
    export function App() { return <main><Watcher /><button onClick={() => note('clicked')}>add</button></main>; }` },
  { runtimePath: '@memoized-dom/runtime/testing' })['./App.tsx']!;
  // The edit's receiver is read untracked; nothing else changes.
  expect(code).toContain('editArray(_MD.untracked(_read_log), "push"');
  const directory = join(import.meta.dirname, '../../../tests/out/mutation-unit');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  // Counted outside the compiled code: a global it wrote would be state the effect reads.
  let runs = 0;
  (globalThis as { countRun?: () => void }).countRun = () => { runs++; };
  const root = module.App('edits-not-reads', null) as HTMLElement;
  document.body.append(root);
  await Bun.sleep(20);
  expect(runs).toBe(1);

  root.querySelector('button')!.click();
  await Bun.sleep(20);
  expect(module.log).toEqual(['watched', 'clicked']);
  expect(runs).toBe(1);
  root.remove();
});

it('keeps an effect following state it reads after it also writes it', async () => {
  // Its own push must not run it again, but a later push by anything else must.
  const code = compileModules({ './App.tsx': `export const log = [];
    function Watcher() {
      $effect(() => { seen(log.length); if (log.length === 1) log.push('auto'); });
      return <p>watching</p>;
    }
    export function App() { return <main><Watcher /><button onClick={() => log.push('clicked')}>add</button></main>; }` },
  { runtimePath: '@memoized-dom/runtime/testing' })['./App.tsx']!;
  const directory = join(import.meta.dirname, '../../../tests/out/mutation-unit');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  const lengths: number[] = [];
  (globalThis as { seen?: (length: number) => void }).seen = (length) => { lengths.push(length); };
  const root = module.App('reads-and-writes', null) as HTMLElement;
  document.body.append(root);
  await Bun.sleep(20);
  for (let click = 0; click < 2; click++) {
    root.querySelector('button')!.click();
    await Bun.sleep(20);
  }
  expect(module.log).toEqual(['clicked', 'auto', 'clicked']);
  expect(lengths).toEqual([0, 1, 3]);
  root.remove();
});

it('evaluates a computed key once, before the RHS, retaining postfix results', async () => {
  const { root, module } = await compile(`const item = { count: 1 };
    const key = { [Symbol.toPrimitive]() { log.push('key'); return 'count'; } };`,
    `const old = item[key]++; log.push(old); item[key] = (log.push('rhs'), 4);`);
  root.querySelector('button')!.click();
  expect(root.querySelector('p')!.textContent).toBe('4:-');
  expect(module.log).toEqual(['key', 1, 'key', 'rhs']);
});

it('preserves short circuit member assignments and setter receivers', async () => {
  const { root, module } = await compile(`const item = { n: 1,
    get count() { log.push('get'); return this.n; },
    set count(value) { log.push('set'); this.n = value; }
  };`, `item.count ||= (log.push('rhs'), 9); item.count &&= 5;`);
  module.log.length = 0;
  root.querySelector('button')!.click();
  expect(root.querySelector('p')!.textContent).toBe('5:-');
  expect(module.log).toEqual(['get', 'get', 'set', 'get']);
});

it('reports completed member pattern targets before a later getter throws', async () => {
  const { root, module } = await compile('const item = { count: 1 };',
    `({ a: item.count, b: item.other } = { a: 7, get b() { throw Error('pattern'); } });`);
  expect(() => module.run()).toThrow('pattern');
  await Promise.resolve();
  expect(root.querySelector('p')!.textContent).toBe('7:-');
});

it('reports native member loop targets and delete results', async () => {
  const { root, module } = await compile('const item = { count: 1, other: 2 };',
    `for (item.count of [2, 3]) {} log.push(delete item.other);`);
  root.querySelector('button')!.click();
  expect(root.querySelector('p')!.textContent).toBe('3:-');
  expect(module.log).toEqual([true]);
});
