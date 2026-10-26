/** Direct member stores keep native evaluation and report each completed target. */
import { b, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { MutationPlan } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, numberLiteral, statement, stringLiteral } from '../../core/emit/quote';

export function emitMutations(
  plans: readonly MutationPlan[], versions: ReadonlyMap<BindingNode, string>, names: Names,
  runtime: string, batch: string | null, initial: ReadonlyMap<Node, Node>,
  keys: ReadonlyMap<BindingNode, string> = new Map(),
  /** A shared owner's declared notifiers, also its watched roots' (`shared-dom.ts`). */
  declared: ReadonlyMap<BindingNode, string> = new Map(),
) {
  const replacements = new Map(initial);
  const declarations: Statement[] = [];
  // One notification per binding: every edit of `data` bumps the same version
  // and marks the same batch, wherever the edit is.
  const notifiers = new Map<BindingNode, string>(declared);
  const notifierOf = (binding: BindingNode): string => {
    let notify = notifiers.get(binding);
    if (notify === undefined) {
      notify = names.fresh(`_mutated_${binding.binding.name}`);
      notifiers.set(binding, notify);
      declarations.push(statement('function $$notify() { $$version++; $$commit; }', {
        notify, version: versions.get(binding)!, commit: batch === null ? expression('void 0')
          : keys.has(binding) ? expression('$$batch.mark($$key)', { batch, key: keys.get(binding)! }) : expression('$$batch.mark()', { batch }),
      }));
    }
    return notify;
  };
  for (const plan of [...plans].sort((a, b) => (a.operation.end - a.operation.start) - (b.operation.end - b.operation.start))) {
    const notifications = [];
    const reads = [];
    for (const { binding, member } of plan.targets) {
      if (plan.kind !== 'call' && !is.MemberExpression(member)) continue;
      const notify = notifierOf(binding);
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
    if (plan.kind === 'call' && plan.method !== undefined) {
      // `observeMethod(…, receiver, key, proven)(...arguments)` keeps native
      // order: receiver, key, method read, arguments, call (`optimize/methods.ts`).
      const call = copy(plan.operation, replacements);
      if (is.CallExpression(call) && is.MemberExpression(call.callee)) {
        const member = call.callee;
        // One row cache per call site and owner instance (`runtime/src/list-map.ts`),
        // or the rows of the text site this call is (`core/emit/row-list.ts`).
        let rows: Expression = expression('void 0');
        if (plan.method.rowList === true) {
          rows = expression('$$list', { list: names.of(plan.operation, '_rowList') });
        } else if (plan.method.rowReuse !== undefined) {
          const cache = names.fresh('_rows');
          declarations.push(statement(`const $$cache = $$runtime.createRowCache(${plan.method.rowReuse.usesIndex});`, {
            cache, runtime,
          }));
          rows = expression('$$cache', { cache });
        }
        call.callee = expression('$$runtime.observeMethod($$reads, $$notifications, $$receiver, $$key, $$proven, $$rows)', {
          runtime, receiver: member.object,
          key: member.computed ? member.property : stringLiteral((member.property as { name: string }).name),
          reads: b.ArrayExpression({ elements: reads }), notifications: b.ArrayExpression({ elements: notifications }),
          proven: numberLiteral(plan.method.provenCallbacks), rows,
        });
        replacements.set(plan.operation, call);
        continue;
      }
    }
    if (plan.kind === 'call' && plan.helper !== undefined) {
      // `observeHelper(…, helper)(...arguments)`: the callee is read before the
      // arguments, which are effect-free (`optimize/helpers.ts`).
      const call = copy(plan.operation, replacements);
      if (is.CallExpression(call)) {
        const copies = b.ArrayExpression({
          elements: plan.helper.copies.map(([index, name]) => b.ArrayExpression({ elements: [numberLiteral(index), stringLiteral(name)] })),
        });
        const methods = b.ArrayExpression({ elements: plan.helper.methods.map((name) => stringLiteral(name)) });
        const primitives = b.ArrayExpression({ elements: plan.helper.primitives.map(numberLiteral) });
        const propertyKeys = b.ArrayExpression({ elements: plan.helper.propertyKeys.map(numberLiteral) });
        call.callee = expression('$$runtime.observeHelper($$reads, $$notifications, $$copies, $$methods, $$helper, $$primitives, $$propertyKeys)', {
          runtime, helper: call.callee, copies, methods, primitives, propertyKeys,
          reads: b.ArrayExpression({ elements: reads }), notifications: b.ArrayExpression({ elements: notifications }),
        });
        replacements.set(plan.operation, call);
        continue;
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
  return { replacements, declarations, notifiers: notifiers as ReadonlyMap<BindingNode, string> };
}
