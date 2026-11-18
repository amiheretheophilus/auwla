import { describe, expect, it } from 'bun:test';
import { compileModules } from '../../pipeline';

const tracked = (code: string) => /_read_|createSharedWrites/.test(code);

describe('module state nothing reactive reads', () => {
  it('needs no reader when read only at module top levels', () => {
    const output = compileModules({
      './db.ts': 'export const database = { users: new Map() };',
      './server.ts': `import { serve } from 'pkg'; import { database } from './db';
        const app = serve({ services: { database } }); app.ssr(1); export default app;`,
      './unused.ts': 'export const options = { a: 1 };',
    }, { entries: ['./server.ts', './unused.ts'] });
    for (const code of Object.values(output)) expect(tracked(code)).toBe(false);
    expect(output['./db.ts']!.length).toBeLessThan(60);
  });

  it('keeps its reader when a component reads it, in another module', () => {
    const output = compileModules({
      './a.ts': 'export const options = { a: 1 };',
      './App.tsx': `import { options } from './a'; export function App() { return <p>{options.a}</p>; }`,
    }, { entries: ['./App.tsx'] });
    expect(output['./a.ts']).toContain('_read_options');
  });

  it('keeps the reader of what a followed derivation reads', () => {
    const output = compileModules({
      './App.tsx': `const base = { n: 1 }; const view = base;
        export function App() { return <p>{view.n}</p>; }`,
    }, { entries: ['./App.tsx'] });
    expect(output['./App.tsx']).toContain('_read_view');
    expect(output['./App.tsx']).toContain('_read_base');
  });

  it('keeps the reader of a default export another module imports', () => {
    const output = compileModules({
      './store.ts': 'const store = { n: 1 }; export function bump() { store.n++; } export default store;',
      './App.tsx': `import store, { bump } from './store'; export function App() { return <button onClick={bump}>{store.n}</button>; }`,
    }, { entries: ['./App.tsx'] });
    expect(tracked(output['./store.ts']!) || Object.keys(output).some((path) => path.includes('.mmd.') && tracked(output[path]!))).toBe(true);
  });
});
