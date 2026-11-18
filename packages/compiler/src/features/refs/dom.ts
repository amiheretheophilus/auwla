/** Assignable refs and forwarded callbacks share the runtime's ref contract. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { RefPlan } from '../../core/plan/model';
import { copy, finishCopy } from '../../core/emit/copy';
import { expression, stringLiteral } from '../../core/emit/quote';

export function emitRefs(refs: readonly RefPlan[], runtime: string, initial: ReadonlyMap<Node, Node>, external = false) {
  const replacements = new Map(initial);
  for (const ref of refs) {
    const read = new Map(initial);
    // A member's store replacement belongs only to the generated assignment.
    read.delete(ref.expression);
    const current = finishCopy(copy(ref.expression, read));
    const writes = new Map(initial);
    if (external && is.MemberExpression(ref.expression)) {
      // An imported object has no local version to bump. The existing mutation
      // observer notifies the defining module's watched roots by object identity.
      const target = copy(ref.expression, read);
      writes.set(ref.expression, expression('$$runtime.mutationTarget($$object, $$key, () => {}).value', {
        runtime, object: target.object,
        key: target.computed ? target.property : stringLiteral((target.property as { name: string }).name),
      }));
    }
    const assignment = finishCopy(copy(ref.assignment, writes));
    replacements.set(ref.expression, expression('$$runtime.assignRef(() => $$current, $$value => { $$assignment; })', {
      runtime, current, value: ref.value, assignment,
    }));
  }
  return replacements;
}
