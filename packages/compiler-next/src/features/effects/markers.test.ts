/** `$effect` and `$cleanup` are called directly or refused (`markers.ts`). */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../..';

function compile(source: string): void {
  compileModules({ './App.tsx': source });
}

describe('lifecycle markers are called directly', () => {
  it('refuses $effect stored in a variable, with what to write instead', () => {
    expect(() => compile(`
      export function App() { let n = 0; const run = $effect; run(() => { n; }); return <p>{n}</p>; }
    `)).toThrow('`$effect` must be called directly, as `$effect(() => …)`: the compiler replaces that call, and there is no `$effect` value at run time.');
  });

  it('refuses $cleanup passed along or inspected', () => {
    expect(() => compile(`
      function later(register) { register(() => {}); }
      export function App() { later($cleanup); return <p/>; }
    `)).toThrow('`$cleanup` must be called directly');
    expect(() => compile(`
      export function App() { return <p>{typeof $cleanup}</p>; }
    `)).toThrow('`$cleanup` must be called directly');
  });

  it('accepts direct calls, in a component and in a helper', () => {
    expect(() => compile(`
      function useTimer() { const id = setInterval(() => {}, 1000); $cleanup(() => clearInterval(id)); }
      export function App() { let n = 0; $effect(() => { n; }); useTimer(); return <p>{n}</p>; }
    `)).not.toThrow();
  });

  it('leaves a module its own function named $effect', () => {
    expect(() => compile(`
      function $effect(callback) { return callback; }
      export function App() { const run = $effect; run(() => {}); return <p/>; }
    `)).not.toThrow();
  });
});
