/** Direct member stores keep native evaluation and report each completed target. */
import { b, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { MutationPlan } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement, stringLiteral } from '../../core/emit/quote';

export function emitMutations(
  plans: readonly MutationPlan[], versions: ReadonlyMap<BindingNode, string>, names: Names,
  runtime: string, batch: string | null, initial: ReadonlyMap<Node, Node>,
) {
  const replacements = new Map(initial);
  const declarations: Statement[] = [];
  for (const plan of [...plans].sort((a, b) => (a.operation.end - a.operation.start) - (b.operation.end - b.operation.start))) {
    const notifications = [];
    const reads = [];
    for (const { binding, member } of plan.targets) {
      if (plan.kind !== 'call' && !is.MemberExpression(member)) continue;
      const notify = names.fresh('_mutated');
      const version = versions.get(binding)!;
      declarations.push(statement('function $$notify() { $$version++; $$commit; }', {
        notify, version, commit: batch === null ? expression('void 0') : expression('$$batch.mark()', { batch }),
      }));
      if (plan.kind === 'call') {
        notifications.push(expression('$$notify', { notify }));
        reads.push(expression('() => $$binding', { binding: binding.binding.name }));
        continue;
      }
      if (plan.kind === 'delete') {
        if (!is.MemberExpression(member)) continue;
        const target = copy(member, replacements);
        replacements.set(plan.operation, expression('$$runtime.deleteMutation($$object, $$key, $$notify)', {
          runtime, object: target.object,
          key: target.computed ? target.property : stringLiteral((target.property as { name: string }).name), notify,
        }));
      } else {
        if (!is.MemberExpression(member)) continue;
        if (is.PrivateIdentifier(member.property)) continue;
        const target = copy(member, replacements);
        replacements.set(member, expression('$$runtime.mutationTarget($$object, $$key, $$notify).value', {
          runtime, object: target.object,
          key: target.computed ? target.property : stringLiteral((target.property as { name: string }).name), notify,
        }));
      }
    }
    if (plan.kind === 'call') {
      const operation = copy(plan.operation, replacements);
      replacements.set(plan.operation, expression('$$runtime.observeMutation($$reads, $$notifications).finish($$operation)', {
        runtime, operation,
        reads: b.ArrayExpression({ elements: reads }), notifications: b.ArrayExpression({ elements: notifications }),
      }));
    }
  }
  return { replacements, declarations };
}
