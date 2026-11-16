/** `$snapshot(value)` initializes a declaration, and its reads are no input (`snapshot.ts`). */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../..';

function compile(source: string): string {
  return compileModules({ './App.tsx': source })['./App.tsx']!;
}

describe('$snapshot is a declaration initializer', () => {
  it('refuses $snapshot inside markup, where nothing keeps the value', () => {
    expect(() => compile(`export function App() { let n = 0; return <p>{$snapshot(n)}</p>; }`))
      .toThrow('`$snapshot(value)` must be the whole initializer of a declaration, as in `const saved = $snapshot(value)`');
  });

  it('refuses $snapshot inside a larger initializer', () => {
    expect(() => compile(`export function App() { let n = 0; const x = $snapshot(n) + 1; return <p>{x}</p>; }`))
      .toThrow('must be the whole initializer of a declaration');
  });

  it('refuses $snapshot as a value', () => {
    expect(() => compile(`export function App() { const take = $snapshot; return <p/>; }`))
      .toThrow('`$snapshot` must be called directly, as `const saved = $snapshot(value)`: the compiler replaces that call, and there is no `$snapshot` value at run time.');
  });

  it('refuses $snapshot with no value, two values or a spread', () => {
    for (const args of ['', 'a, b', '...list']) {
      expect(() => compile(`export function App() { const a = 1, b = 2, list = [a]; const x = $snapshot(${args}); return <p>{x}</p>; }`))
        .toThrow('`$snapshot` takes exactly one value: `const saved = $snapshot(value)`.');
    }
  });

  it('reports the error at the call, in authored coordinates', () => {
    expect(() => compile(`export function App() {\n  let n = 0;\n  return <p>{$snapshot(n)}</p>;\n}`))
      .toThrow('./App.tsx:3:14');
  });
});

describe('$snapshot takes a value once', () => {
  it('reads its value untracked, and the binding follows nothing', () => {
    const code = compile(`
      export function App() { let count = 1; const initial = $snapshot(count); return <button onClick={() => count++}>{initial}</button>; }
    `);
    expect(code).toContain('const initial = _MD.untracked(() => count);');
    expect(code).not.toContain('$snapshot');
  });

  it('is an ordinary call in a module with its own $snapshot', () => {
    const code = compile(`
      function $snapshot(value) { return value; }
      export function App() { let n = 0; const x = $snapshot(n); return <button onClick={() => n++}>{x}</button>; }
    `);
    expect(code).toContain('$snapshot(n)');
    expect(code).not.toContain('untracked(() => n)');
  });

  it('works in a module with nothing else to compile', () => {
    const code = compileModules({
      './main.ts': `import { first } from './first'; console.log(first);`,
      './first.ts': `const start = Date.now(); export const first = $snapshot(start);`,
    })['./first.ts']!;
    expect(code).toContain('untracked(() => start)');
    expect(code).toContain('import * as');
  });
});
