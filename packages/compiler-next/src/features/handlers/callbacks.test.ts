/**
 * Callback boundaries (`callbacks.ts`) composed with other features' rewrites of the same body.
 * Behaviour of the boundaries themselves is in `tests/scheduling.test.ts`.
 */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../../pipeline';

describe('a handed-out callback keeps what other features put in its body', () => {
  it('declares the source readiness records it uses', () => {
    // A callback given to unknown code that builds a value from a source: readiness declares
    // per-call records at the top of its body, and the boundary instrumentation used to replace
    // that body with the authored one, so the records were used but never declared.
    const output = compileModules({
      './App.tsx': `
        import { $fetch } from '@memoized-dom/data';
        import { register, wrap } from 'lib';
        register({ prepare: wrap(async (state, read) => {
          const result = await read($fetch('/api/items'));
          state.items = result.map((item) => item.name);
          return state;
        }) });
        export function App() { return <p>x</p>; }`,
    })['./App.tsx']!;

    // Each name's first appearance is its declaration.
    for (const name of ['_sourceStep', '_sourceBinding']) {
      const declared = output.indexOf(`const ${name} =`);
      expect(declared).toBeGreaterThan(-1);
      expect(output.indexOf(name)).toBe(declared + 'const '.length);
    }
    expect(output).toContain('enterCallback()');
  });
});
