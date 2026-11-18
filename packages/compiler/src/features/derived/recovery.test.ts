/** Caught setup failures must not turn subsequent body writes into takeover. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findAll } from 'yuku-ast';
import { parse } from 'yuku-parser';
import { setScheduler } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

let sequence = 0;
afterEach(clearCompiledApps);

it('keeps escaped block memos live when a later setup statement throws', async () => {
  const source = `export function App() {
    let read, increment;
    try {
      let count = 1;
      const twice = count * 2;
      read = () => twice;
      increment = () => count++;
      throw new Error('after escape');
    } catch {}
    return <main><p>{read()}</p><button onClick={increment}>inc</button></main>;
  }`;
  const code = compileModules({ './App.tsx': source }, { runtimePath: '@memoized-dom/runtime/testing' })['./App.tsx']!;
  const output = parse(code, { lang: 'js', sourceType: 'module' });
  expect(output.diagnostics).toEqual([]);
  expect(findAll(output.program, 'TryStatement')).toHaveLength(1);
  const directory = join(import.meta.dirname, '../../../tests/out/recovery-unit');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `case-${sequence++}.js`);
  writeFileSync(path, code);
  const module = await import(pathToFileURL(path).href);
  setScheduler((run) => run());
  const root = module.App('recovery', null) as HTMLElement;
  expect(root.querySelector('p')!.textContent).toBe('2');
  root.querySelector('button')!.click();
  expect(root.querySelector('p')!.textContent).toBe('4');
});

for (const [name, recover] of [
  ['catch', 'try { Child(); } catch (error) { build(); }'],
  ['finally with an outer catch', 'try { try { Child(); } finally { build(); } } catch {}'],
  ['nested catches and rethrow', 'try { try { Child(); } catch (error) { throw error; } } catch { build(); }'],
  ['catch binding default', 'try { Child(); } catch ({ value = build() }) {}'],
  ['finally after a second failure in catch', 'try { Child(); } catch { try { Child(); } finally { build(); } }'],
] as const) {
  it(`restores the parent before ${name}`, async () => {
    const source = `
      function Child() { throw {}; return <span>child</span>; }
      export function App() {
        let seed = 1;
        let total = 0;
        function build() { total += seed; }
        function recover() { try { ${recover} } catch {} }
        recover();
        return <main><p>{total}</p><button onClick={() => seed++}>more</button></main>;
      }`;
    const code = compileModules({ './App.tsx': source }, {
      runtimePath: '@memoized-dom/runtime/testing',
    })['./App.tsx']!;
    const authored = parse(source, { lang: 'tsx', sourceType: 'module' });
    const output = parse(code, { lang: 'js', sourceType: 'module' });
    expect(output.diagnostics).toEqual([]);
    expect(findAll(output.program, 'TryStatement').length).toBe(
      findAll(authored.program, 'TryStatement').length,
    );
    const directory = join(import.meta.dirname, '../../../tests/out/recovery-unit');
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `case-${sequence++}.js`);
    writeFileSync(path, code);
    const module = await import(pathToFileURL(path).href);
    setScheduler((run) => run());
    const root = module.App('recovery', null) as HTMLElement;
    expect(root.querySelector('p')!.textContent).toBe('1');
    root.querySelector('button')!.click();
    expect(root.querySelector('p')!.textContent).toBe('2');
  });
}
