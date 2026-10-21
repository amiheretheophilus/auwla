import { expect, it } from 'bun:test';
import { classifyGraph } from '../../core/graph/classify';
import { parseModule } from '../../core/parse';
import { resolve } from '../../core/resolve';
import { planModules } from '../../core/plan';
import { emitDom } from '../../core/emit/dom';

function inspect(source: string) {
  const resolved = resolve([parseModule('App.tsx', source)], {});
  const graph = classifyGraph(resolved);
  const original = resolved.modules[0]!.module.ast;
  const before = JSON.stringify(original);
  const plan = planModules(graph, graph.queries, graph.components)[0]!;
  return { original, before, plan, component: [...plan.components.values()][0]! };
}

it('keeps one native declaration for all names of a pattern', () => {
  const { component } = inspect(`export function App() {
    let point = { x: 1 }, fallback = 2;
    const { x, y = fallback } = point;
    return <button onClick={() => { point = {}; fallback++; }}>{x}:{y}</button>;
  }`);
  const memo = component.memos.flatMap((group) => group.computations).find((entry) => entry.targets.some((target) => target.binding.name === 'x'))!;
  expect(memo.targets.map((target) => target.binding.name)).toEqual(['x', 'y']);
  expect(memo.inputs.map((input) => input.binding.name)).toEqual(['point', 'fallback']);
  expect(memo.declarator).toBe(memo.declaration.declarations[0]!);
});

it('keeps definite builders and excludes merely possible calls', () => {
  const { component } = inspect(`export function App() {
    let count = 1;
    let total = count;
    if (count) total += 1;
    console.log(total);
    return <button onClick={() => count++}>{total}</button>;
  }`);
  const memo = component.memos.flatMap((group) => group.computations).find((entry) => entry.targets.some((target) => target.binding.name === 'total'))!;
  expect(memo.builders.map((builder) => builder.type)).toEqual(['IfStatement']);
  expect(memo.inputs.map((input) => input.binding.name)).toEqual(['count']);
});

it('retains authored identities through planning and emission of replay', () => {
  const { original, before, plan } = inspect(`export function App() {
    let count = 1;
    const { value } = { value: count };
    let total = 0;
    for (let i = 0; i < value; i++) total += i;
    return <button onClick={() => count++}>{total}</button>;
  }`);
  emitDom(plan, {});
  expect(JSON.stringify(original)).toBe(before);
});
