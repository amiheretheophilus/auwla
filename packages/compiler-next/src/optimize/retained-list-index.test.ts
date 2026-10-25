/** The pass changes row bookkeeping, never authored calls or input graph facts. */
import { expect, it } from 'bun:test';
import { classifyGraph } from '../core/graph/classify';
import { parseModule } from '../core/parse';
import { planModules } from '../core/plan';
import { resolve } from '../core/resolve';
import { compileModules } from '../pipeline';
import { optimizeModules } from '.';

function inspect(source: string) {
  const resolved = resolve([parseModule('./App.tsx', source)], {});
  const graph = classifyGraph(resolved);
  const plans = planModules(graph, graph.queries, graph.components);
  return { graph, plans, ast: resolved.modules[0]!.module.ast };
}

it('keeps the general plan and authored tree intact while selecting indexed slots', () => {
  const { graph, plans, ast } = inspect(`
    export function App({ children }) {
      return <ul>{children}</ul>;
    }
  `);
  const before = JSON.stringify(ast);
  const optimized = optimizeModules(plans, graph);
  const general = [...plans[0]!.components.values()][0]!;
  const fast = [...optimized[0]!.components.values()][0]!;
  expect(optimizeModules(plans, graph, false)).toBe(plans);
  expect(fast).not.toBe(general);
  expect(general.sites[0]?.expression).toBe(fast.sites[0]?.expression);
  expect(general.sites[0]).not.toHaveProperty('listStrategy');
  expect(fast.sites[0]).toHaveProperty('listStrategy', 'retained-index');
  expect(JSON.stringify(ast)).toBe(before);
});

it('keeps proven primitive-only plans unchanged', () => {
  const { graph, plans } = inspect('export function App() { return <p>{1 + 2}</p>; }');
  const optimized = optimizeModules(plans, graph);
  expect(optimized[0]).toBe(plans[0]);
});

it('selects nested branch and stored-value slots without treating method names as pure', () => {
  const source = `
    export function App({ collection, shown }) {
      const view = <section>{collection.unfamiliar()}</section>;
      return <main>{shown ? <ul>{collection.map()}</ul> : view}</main>;
    }
  `;
  const enabled = compileModules({ './App.tsx': source })['./App.tsx']!;
  const disabled = compileModules({ './App.tsx': source }, { optimize: false })['./App.tsx']!;
  expect(enabled).toContain('createIndexedValueSlot');
  expect(disabled).not.toContain('createIndexedValueSlot');
  expect(disabled).toContain('.unfamiliar(');
  expect(disabled).toContain('.map(');
  expect(disabled).toContain('.observeMutation(');
  // `optimize/methods.ts` still calls and observes both; the runtime proof
  // keys on the callee's identity, never on these names.
  expect(enabled).toContain('collection, "unfamiliar", 0, void 0)()');
  expect(enabled).toContain('collection, "map", 0, void 0)()');
});
