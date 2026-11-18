/** Ref adapters expose their assignments to the existing write/mutation emitters. */
import { b, is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { SemanticGraph } from '../../core/graph';
import type { RefPlan } from '../../core/plan/model';
import { refTargets } from './classify';

export function planRefs(graph: SemanticGraph): RefPlan[] {
  return refTargets(graph.resolved).flatMap(({ expression, binding }) => {
    const target = graph.bindings.get(binding);
    if (target === undefined) return [];
    const taken = new Set([...binding.module.bindings.map((entry) => entry.name), ...binding.module.references.map((entry) => entry.name)]);
    let name = `_refNode${expression.start}`;
    while (taken.has(name)) name += '_';
    const value = b.Identifier({ name });
    // An identifier in the generated PutValue is a write, never a tracked read.
    // Member roots remain authored reads and retain their native evaluation.
    const left = is.Identifier(expression) ? b.Identifier({ name: expression.name }) : expression;
    const assignment = b.AssignmentExpression({ operator: '=', left, right: value });
    return [{ expression, binding: target, value, assignment }];
  });
}

export function refWrites(refs: readonly RefPlan[]) {
  return refs.filter((ref) => is.Identifier(ref.expression)).map((ref) => ({
    operation: ref.assignment as Node, targets: [ref.binding],
  }));
}

export function refMutations(refs: readonly RefPlan[]) {
  return refs.filter((ref) => is.MemberExpression(ref.expression)).map((ref) => ({
    operation: ref.assignment as Node, kind: 'store' as const,
    targets: [{ binding: ref.binding, member: ref.expression }],
  }));
}
