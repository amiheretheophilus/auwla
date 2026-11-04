/** Direct member stores keep native evaluation and report each completed target. */
import { b, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { MutationPlan } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement, stringLiteral } from '../../core/emit/quote';
import { isValueImport } from '../../core/resolve/exports';
import type { Binding } from 'yuku-analyzer';

interface MutationEmitOptions {
  readonly keys?: ReadonlyMap<BindingNode, string>;
  /** Shared owners and row handlers can supply their existing notifier. */
  readonly notifiers?: ReadonlyMap<BindingNode, string>;
  /** A transparent binding is observed through its payload, not its handle. */
  readonly values?: ReadonlyMap<BindingNode, Expression>;
  /** Native namespaces expose initialized data roots without enumerating TDZ exports. */
  readonly importedValues?: ReadonlyMap<Binding, readonly Expression[]>;
  readonly changed?: ReadonlyMap<BindingNode, Expression>;
}

export function emitMutations(
  plans: readonly MutationPlan[],
  versions: ReadonlyMap<BindingNode, string>,
  names: Names,
  runtime: string,
  batch: string | null,
  initial: ReadonlyMap<Node, Node>,
  options: MutationEmitOptions = {},
) {
  const keys = options.keys ?? new Map();
  const replacements = new Map(initial);
  const declarations: Statement[] = [];
  // One notification per binding: every edit of `data` bumps the same version
  // and marks the same batch, wherever the edit is.
  const notifiers = new Map<BindingNode, string>(options.notifiers);
  const refNotifiers = new Map<BindingNode, string>();
  let importedNotify: string | undefined;

  const notifierOf = (binding: BindingNode): string => {
    let notify = notifiers.get(binding);

    if (notify === undefined) {
      if (!versions.has(binding) && isValueImport(binding.binding)) {
        // Mutating the value cannot reassign its import. The runtime mutation
        // helper notifies the actual data roots, including a captured default;
        // a second clock in this importing component would be incorrect.
        if (importedNotify === undefined) {
          importedNotify = names.fresh('_importedMutation');
          declarations.push(statement('function $$notify() {}', { notify: importedNotify }));
        }
        notifiers.set(binding, importedNotify);
        return importedNotify;
      }
      notify = names.fresh(`_mutated_${binding.binding.name}`);
      notifiers.set(binding, notify);

      let commit = expression('void 0');
      const key = keys.get(binding);

      if (batch !== null) {
        commit = key === undefined
          ? expression('$$batch.mark()', { batch })
          : expression('$$batch.mark($$key)', { batch, key });
      }

      const changed = options.changed?.get(binding);

      declarations.push(statement(`
        function $$notify() {
          $$version++;
          ${changed === undefined ? '' : '$$changed;'}
          $$commit;
        }
      `, {
        notify,
        version: versions.get(binding)!,
        changed: changed ?? expression('void 0'),
        commit,
      }));
    }

    if (binding.kind !== 'Ref') {
      return notify;
    }

    let refNotify = refNotifiers.get(binding);

    if (refNotify === undefined) {
      refNotify = names.fresh(`_edited_${binding.binding.name}`);
      refNotifiers.set(binding, refNotify);
      declarations.push(statement('function $$refNotify() { if (!$$runtime.isRefNode($$binding)) $$notify(); }', {
        refNotify, runtime, binding: binding.binding.name, notify,
      }));
    }

    return refNotify;
  };
  for (const plan of [...plans].sort((a, b) => (a.operation.end - a.operation.start) - (b.operation.end - b.operation.start))) {
    if (plan.kind === 'call' && plan.method !== undefined) {
      emitKnownCall(plan, replacements, declarations, notifierOf, names, runtime);
      continue;
    }
    const notifications = [];
    const reads = [];
    for (const { binding, member } of plan.targets) {
      if (plan.kind !== 'call' && !is.MemberExpression(member)) continue;
      const notify = notifierOf(binding);
      if (plan.kind === 'call') {
        const payload = options.values?.get(binding);
        const values = payload === undefined
          ? options.importedValues?.get(binding.binding) ?? [expression('$$binding', { binding: binding.binding.name })]
          : [payload];

        for (const value of values) {
          notifications.push(expression('$$notify', { notify }));
          reads.push(expression('() => $$value', { value }));
        }
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
  return { replacements, declarations, notifiers: notifiers as ReadonlyMap<BindingNode, string> };
}

/**
 * A call the compiler knows the effect of (`MutationPlan.method`):
 *
 * - `read`: the authored call as written, or the row list or row cache that
 *   stands in for `map`;
 * - `edit`: `editArray(receiver, "push", [arguments], notify)`, the native call
 *   followed by a report of the receiver's root.
 */
function emitKnownCall(
  plan: MutationPlan,
  replacements: Map<Node, Node>,
  declarations: Statement[],
  notifierOf: (binding: BindingNode) => string,
  names: Names,
  runtime: string,
): void {
  const method = plan.method!;
  if (method.kind === 'read' && method.rowList !== true && method.rowReuse === undefined) {
    return;
  }

  const call = copy(plan.operation, replacements);
  if (!is.CallExpression(call) || !is.MemberExpression(call.callee)) {
    return;
  }
  const receiver = call.callee.object;

  if (method.kind === 'edit') {
    replacements.set(plan.operation, expression('$$runtime.editArray($$receiver, $$name, $$arguments, $$notify)', {
      runtime,
      receiver,
      name: stringLiteral((call.callee.property as { name: string }).name),
      arguments: b.ArrayExpression({ elements: call.arguments }),
      notify: notifierOf(plan.targets[0]!.binding),
    }));
    return;
  }

  if (method.rowList === true) {
    // The rows of the text site this call is (`core/emit/row-list.ts`).
    replacements.set(plan.operation, expression('$$list.map($$receiver)', {
      list: names.of(plan.operation, '_rowList'),
      receiver,
    }));
    return;
  }

  // One row cache per call site and owner instance (`runtime/src/list-map.ts`).
  const cache = names.fresh('_rows');
  declarations.push(statement(`const $$cache = $$runtime.createRowCache(${method.rowReuse!.usesIndex});`, { cache, runtime }));
  replacements.set(plan.operation, expression('$$runtime.mapRows($$receiver, $$cache, $$callback)', {
    runtime,
    receiver,
    cache,
    callback: call.arguments[0]!,
  }));
}
