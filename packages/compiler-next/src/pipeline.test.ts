/** Phase 1 exit check (wiki/compiler/plan.md): modules without JSX compile and run unchanged. */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '.';

const OUT = join(import.meta.dirname, '..', 'tests', 'out', 'pipeline');

/** Writes the compiled modules to disk and imports `entry`. */
async function importCompiled(name: string, output: Record<string, string>, entry: string) {
  const directory = join(OUT, name);
  rmSync(directory, { recursive: true, force: true });
  for (const [path, code] of Object.entries(output)) {
    // Imports name modules without an extension; the files are JavaScript now.
    const file = join(directory, path.replace(/\.tsx?$/, '.js'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, code);
  }
  return import(pathToFileURL(join(directory, entry)).href);
}

describe('compileModules', () => {
  it('compiles modules without JSX so they run as before', async () => {
    const output = compileModules({
      './math.ts': `
        export enum Op { Add, Times }
        export function apply(op: Op, a: number, b: number): number {
          return op === Op.Add ? a + b : a * b;
        }`,
      './main.ts': `
        import { apply, Op } from './math';
        class Total {
          constructor(private value: number) {}
          add(n: number) { this.value = apply(Op.Add, this.value, n); return this; }
          get result() { return this.value; }
        }
        export const answer = new Total(2).add(3).result * apply(Op.Times, 2, 4);`,
    });
    const main = await importCompiled('typescript', output, 'main.js');
    expect(main.answer).toBe(40);
  });

  it('keeps the paths it was given', () => {
    const output = compileModules({ './a.js': 'export const a = 1;', './dir/b.ts': 'export const b: number = 2;' });
    expect(Object.keys(output)).toEqual(['./a.js', './dir/b.ts']);
    expect(output['./dir/b.ts']).not.toContain('number');
  });

  it('says which phase compiles JSX', () => {
    const compile = () => compileModules({ './App.tsx': 'export const App = () => <p />;' });
    expect(compile).toThrow('Phase 3');
  });
});
