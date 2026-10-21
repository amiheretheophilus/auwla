/** Local versions for the assignment/update slice. Shared cells join later. */
import type { Node } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../../core/graph';

export function planLocalState(graph: SemanticGraph, components: ReadonlySet<Node>): ReadonlyMap<Node, readonly BindingNode[]> {
  const owners = new Map<Node, BindingNode[]>();
  for (const node of graph.bindings.values()) {
    const owner = node.owner.runner;
    if (owner === null || !components.has(owner)) continue;
    if (!node.writes.some(({ site }) => site.kind === 'assign' || site.kind === 'update')) continue;
    const bindings = owners.get(owner) ?? [];
    bindings.push(node);
    owners.set(owner, bindings);
  }
  return owners;
}
