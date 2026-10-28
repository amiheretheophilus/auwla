/** Every omitted slot/root needs an invariant over initialization and all writes. */
import { expect, it } from 'bun:test';
import { is } from 'yuku-ast';
import { classifyGraph } from '../core/graph/classify';
import { parseModule } from '../core/parse';
import { planModules } from '../core/plan';
import { resolve } from '../core/resolve';
import { primitiveBindings, primitiveValues } from './primitive-values';

function inspect(source: string) {
  const resolved = resolve([parseModule('./App.tsx', source)], {});
  const graph = classifyGraph(resolved);
  const plan = planModules(graph, graph.queries, graph.components)[0]!;
  return { graph, plan, module: resolved.modules[0]!.module };
}

it.each([
  ['numeric updates', 'let value = 0; function later() { value++; }', true],
  ['bigint updates', 'let value = 1n; function later() { value--; }', true],
  ['string arithmetic', "let value = 'a'; function later() { value += 'b'; }", true],
  ['uninitialized lexical storage', 'let value; value = 2;', true],
  ['computed primitive initialization', 'const value = input * 2;', true],
  ['logical stores', 'let value = 0; value ||= 2; value ??= 3; value &&= 4;', true],
  ['conditional stores', 'let value = 0; value = input ? 1 : 2;', true],
  ['a shadowed object binding', 'let value = 0; { let value = []; }', true],
  ['a later object store', 'let value = 0; function later() { value = []; }', false],
  ['a getter that writes', 'let value = 0; const object = { get x() { value = []; return 1; } };', false],
  ['an unknown call result', 'let value = 0; value = read();', false],
  ['an unproven logical RHS', 'let value = 0; value ||= read();', false],
  ['a type annotation without runtime proof', 'let value: number = read();', false],
  ['a binding alias initializer', 'let value = input;', false],
  ['a destructuring declaration', 'const { value = 0 } = input;', false],
  ['a destructuring store', 'let value = 0; [value] = input;', false],
  ['an existing iterable target', 'let value = 0; for (value of input) {}', false],
  ['an implicit iterable value', 'for (let value of input) {}', false],
  ['an implicit enumeration value', 'for (let value in input) {}', false],
  ['var storage', 'var value = 0; value++;', false],
  ['an object initializer', 'let value = []; value++;', false],
  ['a regexp initializer', 'const value = /x/;', false],
] as const)('checks primitive storage: %s', (_name, setup, expected) => {
  const { plan, graph } = inspect(`export function App({ input }) { ${setup} return <p />; }`);
  const proven = [...primitiveBindings(plan, graph)].some((binding) => binding.name === 'value');
  expect(proven).toBe(expected);
});

it('preserves the general plan and syntax while specializing local sites and roots', () => {
  const { plan, graph, module } = inspect(`export function App() {
    let value = 0;
    return <button onClick={() => value++}>{value}</button>;
  }`);
  const before = JSON.stringify(module.ast);
  const general = [...plan.components.values()][0]!;
  const optimized = primitiveValues.match(plan, graph)!;
  const fast = [...optimized.components.values()][0]!;

  expect(general.mutationRoots).toHaveLength(1);
  expect(fast.mutationRoots).toHaveLength(0);
  expect(general.sites.filter((site) => site.kind === 'text').map((site) => site.primitive)).toEqual([false]);
  expect(fast.sites.filter((site) => site.kind === 'text').map((site) => site.primitive)).toEqual([true]);
  expect(fast.writes).toBe(general.writes);
  expect(fast.mutations).toBe(general.mutations);
  expect(fast.siteInputs).toBe(general.siteInputs);
  expect(JSON.stringify(module.ast)).toBe(before);
});

it('uses binding identity in branches and stored views, retaining props and shadowed values', () => {
  const { plan, graph } = inspect(`export function App({ input }) {
    let value = 0;
    const view = <b>{value || 'empty'}</b>;
    function Child({ value }) { return <i>{value}</i>; }
    return <main>{input ? <p>{value}</p> : <p>{input}</p>}{view}
      <Child value={input} /><button onClick={() => value++}>inc</button></main>;
  }`);
  const optimized = primitiveValues.match(plan, graph)!;
  const component = [...optimized.components.values()].find((entry) => {
    return is.FunctionDeclaration(entry.fn) && entry.fn.id?.name === 'App';
  })!;
  const conditional = component.sites.find((site) => site.kind === 'conditional')!;

  if (conditional.kind !== 'conditional') throw new Error('Expected a conditional site');
  expect(conditional.branches.map((branch) => branch.sites.map((site) => site.kind === 'text' && site.primitive))).toEqual([[true], [false]]);
  expect(optimized.values.some((value) => value.sites.some((site) => site.kind === 'text' && site.primitive))).toBe(true);
  const child = [...optimized.components.values()].find((entry) => entry !== component)!;
  expect(child.sites.some((site) => site.kind === 'text' && site.primitive)).toBe(false);
});

it.each([
  "export function App() { let value = 0; eval('value = []'); return <p>{value}</p>; }",
  "import { $read } from '@memoized-dom/data'; export function App() { const input = $read(load()); let value = 0; return <p>{value}{input}</p>; }",
])('keeps dynamic scope and source presentation on the general path: %s', (source) => {
  const { plan, graph } = inspect(source);
  expect(primitiveBindings(plan, graph).size).toBe(0);
  expect(primitiveValues.match(plan, graph)).toBeNull();
});
