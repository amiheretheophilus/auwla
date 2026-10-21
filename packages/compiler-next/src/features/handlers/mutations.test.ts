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
