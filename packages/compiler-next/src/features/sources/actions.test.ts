import { describe, expect, it } from 'bun:test';
import { compileModules } from '../..';

function compile(source: string, modules: Record<string, string> = {}): void {
  compileModules({ ...modules, './App.tsx': source });
}

describe('action execution contracts', () => {
  it('rejects a known action before component setup can dispatch it', () => {
    expect(() => compile(`
      import { $fetch } from '@memoized-dom/data';

      export function App() {
        const saved = $fetch('/save', { method: 'POST' });
        return <p>{saved}</p>;
      }
    `)).toThrow('POST action');
  });

  it('rejects module actions and follows called local helpers', () => {
    expect(() => compile(`
      import { $fetch } from '@memoized-dom/data';
      const saved = $fetch('/save', { method: 'DELETE' });
    `)).toThrow('DELETE action');

    expect(() => compile(`
      import { $fetch } from '@memoized-dom/data';

      function save() {
        return $fetch('/save', { method: 'PATCH' });
      }

      export function App() {
        save();
        return <p />;
      }
    `)).toThrow('PATCH action');
  });

  it('follows an imported action facade reached from setup', () => {
    expect(() => compile(`
      import { save } from './client';

      export function App() {
        save();
        return <p />;
      }
    `, {
      './client.ts': `
        import { $fetch } from '@memoized-dom/data';
        export const save = () => $fetch('/save', { method: 'POST' });`,
    })).toThrow('`save` is a POST action');
  });

  it('allows event and effect actions without treating callback creation as invocation', () => {
    compile(`
      import { $fetch } from '@memoized-dom/data';

      function save() {
        return $fetch('/save', { method: 'POST' });
      }

      export function App() {
        $effect(() => { save(); });
        register(() => { save(); });
        return <button onClick={async () => { await save(); }}>save</button>;
      }
    `);
  });

  it('keeps unknown methods opaque and permits paused requests', () => {
    expect(() => compile(`
      import { $fetch } from '@memoized-dom/data';

      export function App() {
        const unknown = $fetch('/data', { method });
        const paused = $fetch(null, { method: 'POST' });
        return <p>{unknown}{paused}</p>;
      }
    `)).not.toThrow();
  });
});
