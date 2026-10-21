/** Group actual assignment operations by the analyzer bindings they write. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { WritePlan } from '../../core/plan/model';

export function planWrites(bindings: readonly BindingNode[]): readonly WritePlan[] {
  const operations = new Map<Node, Set<BindingNode>>();
  for (const binding of bindings) {
    for (const { site } of binding.writes) {
      if (site.kind !== 'assign' && site.kind !== 'update') continue;
      const node = site.node;
      if (!is.AssignmentExpression(node) && !is.UpdateExpression(node)
        && !is.ForOfStatement(node) && !is.ForInStatement(node)) continue;
      const targets = operations.get(node) ?? new Set<BindingNode>();
      targets.add(binding);
      operations.set(node, targets);
    }
  }
  return [...operations].map(([operation, targets]) => ({ operation, targets: [...targets] }));
}
