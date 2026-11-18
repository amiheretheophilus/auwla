import { expect, it } from 'bun:test';
import { inspect } from '../../core/graph/test-helpers';
import { planModules } from '../../core/plan';
import { emitDom } from '../../core/emit/dom';

it('separates selector inputs from branch sites and retains authored identities', () => {
  const { graph, node, before } = inspect(`export function App() {
    let show = true, count = 1;
    return <main>{show ? <b>{count}</b> : <i>off</i>}
      <button onClick={() => { show = !show; count++; }}>change</button></main>;
  }`);
  const plan = planModules(graph, graph.queries, graph.components)[0]!;
  const component = [...plan.components.values()][0]!;
  const conditional = component.sites.find((site) => site.kind === 'conditional')!;
  expect(component.siteInputs.get(conditional.expression)).toEqual([node('show')]);
  const branchSite = conditional.branches[0]!.sites[0]!;
  expect(component.siteInputs.get(branchSite.expression)).toEqual([node('count')]);
  expect(conditional.branches).toHaveLength(2);
  emitDom(plan, {});
  expect(graph.resolved.modules.map((entry) => JSON.stringify(entry.module.ast))).toEqual(before);
});

it('plans setup between returns as deferred segments of a selector program', () => {
  const { graph, node, before } = inspect(`export function App() {
    let step = 0, extra = 1;
    if (step === 0) return <b>start</b>;
    let label = 'middle ' + step;
    const log = [];
    if (step === 1) return <i>{label}</i>;
    log.push(extra);
    return <p>{label}</p>;
  }`);
  const plan = planModules(graph, graph.queries, graph.components)[0]!;
  const component = [...plan.components.values()][0]!;
  expect([...component.deferred.values()]).toEqual([0, 0, 1]);
  const program = component.sites[0]!;
  if (program.kind !== 'conditional' || program.selection.kind !== 'program') throw new Error('expected a program');
  expect(program.selection.steps.map((step) => step.kind)).toEqual(['native', 'once', 'native', 'once', 'native']);
  expect(program.selection.fallthrough).toBeNull();
  // Tests are selector inputs; branch markup and once-only setup are not.
  expect(component.siteInputs.get(program.expression)).toEqual([node('step')]);
  emitDom(plan, {});
  expect(graph.resolved.modules.map((entry) => JSON.stringify(entry.module.ast))).toEqual(before);
});

it('keeps returned markup that reads a block-local variable as a captured value', () => {
  const { graph } = inspect(`export function App() {
    let n = 1;
    switch (n % 2) {
      case 0: { const label = 'even'; return <p>{label}</p>; }
      default: return <p>{n}</p>;
    }
  }`);
  const plan = planModules(graph, graph.queries, graph.components)[0]!;
  const program = [...plan.components.values()][0]!.sites[0]!;
  if (program.kind !== 'conditional') throw new Error('expected a conditional');
  // The captured value, the template, and the end of the body after the switch.
  expect(program.branches.map((branch) => branch.template === null)).toEqual([true, false, true]);
  expect(plan.values).toHaveLength(1);
});
