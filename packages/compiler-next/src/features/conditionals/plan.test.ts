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
