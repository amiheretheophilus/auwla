/** Group actual assignment operations by the analyzer bindings they write. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { MutationPlan, WritePlan } from '../../core/plan/model';
import { variableDeclaration } from '../../core/graph/inputs';

export function planReadonlyBindings(bindings: readonly BindingNode[]): readonly BindingNode[] {
  return bindings.filter((target) => {
    const declarator = variableDeclaration(target.binding);
    if (declarator === null) return false;
    const declaration = target.binding.module.parentOf(declarator);
    return is.VariableDeclaration(declaration) && declaration.kind === 'const';
  });
}

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

export function planMutations(bindings: readonly BindingNode[]): readonly MutationPlan[] {
  const operations = new Map<Node, { kind: 'store' | 'delete'; targets: { binding: BindingNode; member: Node }[] }>();
  for (const binding of bindings) {
    const module = binding.binding.module;
    for (const { site } of binding.writes) {
      if (site.kind !== 'member' && site.kind !== 'delete') continue;
      let member: Node = site.reference.node;
      for (const parent of module.ancestors(member)) {
        if (parent === site.node) break;
        if (is.MemberExpression(parent)) member = parent;
      }
      const entry = operations.get(site.node) ?? { kind: site.kind === 'delete' ? 'delete' : 'store', targets: [] };
      entry.targets.push({ binding, member });
      operations.set(site.node, entry);
    }
  }
  return [...operations].map(([operation, entry]) => ({ operation, ...entry }));
}
