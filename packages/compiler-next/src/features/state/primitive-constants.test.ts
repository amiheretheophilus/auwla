import { describe, expect, it } from 'bun:test';
import { compileModules } from '../../pipeline';

function compile(app: string, other?: string): Record<string, string> {
  const modules: Record<string, string> = { './App.tsx': app };
  if (other !== undefined) modules['./values.ts'] = other;
  return compileModules(modules, { entries: ['./App.tsx'] });
}

describe('constant primitives', () => {
  it('need no shared reader, and markup that reads them is static', () => {
    const output = compile(
      `import { count, label } from './values';
       const local = 'x';
       const negative = -1;
       const either = count > 1 ? 'many' : undefined;
       export function App() { return <p title={label}>{count}{local}{negative}{either}</p>; }`,
      `export const count = 1;
       export const label = \`items: \${count}\`;`,
    );

    expect(output['./values.ts']).not.toContain('_read_');
    expect(output['./App.tsx']).not.toContain('_read_');
    expect(output['./App.tsx']).not.toContain('createComputation');
  });

  it('read through a namespace are constants too', () => {
    const output = compile(
      `import * as config from './values';
       const heading = config.title + '!';
       export function App() { return <h1 title={config.title}>{heading}{config.count}</h1>; }`,
      `export const title = 'Site'; export const count = 2;`,
    );
    // No companion module for module state, no readers, no collectors.
    expect(Object.keys(output).sort()).toEqual(['./App.tsx', './values.ts']);
    expect(output['./App.tsx']).not.toContain('_read_');
    expect(output['./App.tsx']).not.toContain('createComputation');
  });

  it('keep a reader for an object, which code the compiler cannot see may edit', () => {
    const output = compile(`const items = ['a']; export function App() { return <p>{items.length}</p>; }`);
    expect(output['./App.tsx']).toContain('_read_items');
  });

  it('keep a reader for a binding that is reassigned', () => {
    const output = compile(`let count = 1; export function bump() { count++; } export function App() { return <p>{count}</p>; }`);
    expect(output['./App.tsx']).toContain('_read_count');
  });

  it('keep following a primitive derived from state, which is computed again', () => {
    const output = compile(
      `let count = 1;
       const label = \`n\${count}\`;
       export function bump() { count++; }
       export function App() { return <p>{label}</p>; }`,
    );
    expect(output['./App.tsx']).toContain('_read_label');
  });

  it('keep a reader for a value a call gives, which may be an object', () => {
    const output = compile(`import { make } from 'pkg'; const value = make(); export function App() { return <p>{value}</p>; }`);
    expect(output['./App.tsx']).toContain('_read_value');
  });

  it('keep a reader for a global the program writes', () => {
    const output = compile(`globalThis.undefined = 1; const value = undefined; export function App() { return <p>{value}</p>; }`);
    expect(output['./App.tsx']).toContain('_read_value');
  });
});
