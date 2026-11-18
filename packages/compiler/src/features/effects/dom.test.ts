/** Emission invariants for the lifecycle path, independent of DOM comparison. */
import { expect, it } from 'bun:test';
import { findAll } from 'yuku-ast';
import { parse } from 'yuku-parser';
import { compileModules } from '../../pipeline';

it('emits valid JavaScript for effects, async cleanup and refs without exception wrappers', () => {
  const output = compileModules({ './App.tsx': `
    function install(callback) { $effect(callback); }
    export function App() {
      let show = true;
      let node;
      let count = 0;
      $cleanup(() => console.log('leave'));
      if (show) install(async () => { const value = count; await Promise.resolve(); return () => console.log(value); });
      return <main><div ref={node} /><p>{count}</p><button onClick={() => count++}>next</button></main>;
    }
  ` })['./App.tsx']!;
  const parsed = parse(output, { lang: 'js', sourceType: 'module' });
  expect(parsed.diagnostics).toEqual([]);
  expect(findAll(parsed.program, ['TryStatement', 'JSXElement', 'JSXFragment'])).toHaveLength(0);
  expect(output).toContain('.ownedEffect(');
  expect(output).toContain('.ownedCleanup(');
  expect(output).toContain('.assignRef(');
  expect(output).toContain('.ownCleanup(');
});

it('leaves shadowed lifecycle functions with ordinary call semantics', () => {
  const output = compileModules({ './App.tsx': `
    const $effect = callback => callback();
    const $cleanup = callback => callback();
    export function App() { $effect(() => {}); $cleanup(() => {}); return <p />; }
  ` })['./App.tsx']!;
  expect(output).not.toContain('.ownedEffect(');
  expect(output).not.toContain('.ownedCleanup(');
});
