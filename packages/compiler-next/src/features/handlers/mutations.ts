/** Direct member stores keep native evaluation and report each completed target. */
import { b, findAll, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { MutationPlan } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement, stringLiteral } from '../../core/emit/quote';
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
  /**
   * Module state's own notifiers. An edit that reports itself (`_edited_todos(todo.id = 2)`)
   * runs no runtime helper to find the state holding the object, so it reports there directly.
   */
  readonly moduleNotifiers?: ReadonlyMap<BindingNode, string>;
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
      if (!versions.has(binding)) {
        // Mutating the value cannot reassign its import, or an alias that is not
        // state. The runtime mutation helper notifies the actual data roots,
        // including a captured default; a second clock here would be incorrect.
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

  // `_moved_data(data[1] = t)`, `_edited_data(data[i].label = x)`: the native store,
  // then its report. An edit also counts, so the data's row lists evaluate their rows.
  const closedNotifiers = new Map<string, string>();
  const closedNotifierOf = (closed: NonNullable<MutationPlan['closed']>): string => {
    const name = closed.binding.binding.name;
    const key = `${closed.kind}:${name}:${closed.binding.binding.declarations[0]!.start}`;
    let notify = closedNotifiers.get(key);
    if (notify !== undefined) return notify;

    notify = names.fresh(closed.kind === 'edit' ? `_edited_${name}` : `_moved_${name}`);
    closedNotifiers.set(key, notify);
    const value = names.fresh('_value');
    const moduleNotify = versions.has(closed.binding) ? undefined : options.moduleNotifiers?.get(closed.binding);
    const report = moduleNotify ?? notifierOf(closed.binding);
    if (closed.kind === 'edit') {
      // Each edit counts, and notes its item, so a row list evaluates only edited items' rows
      // (`uneditedItems`). An edit whose item is unknown notes the map itself: every item.
      const edits = editCounter(closed.binding, names);
      const editedAt = editedItems(closed.binding, names);
      const item = names.fresh('_item');
      declarations.push(statement('var $$edits = 0;', { edits }));
      declarations.push(statement('var $$editedAt = new WeakMap();', { editedAt }));
      declarations.push(statement('function $$notify($$item, $$value) { $$editedAt.set($$item, ++$$edits); $$report(); return $$value; }', {
        notify, item, value, edits, editedAt, report,
      }));
    } else {
      declarations.push(statement('function $$notify($$value) { $$report(); return $$value; }', {
        notify, value, report,
      }));
    }
    return notify;
  };

  for (const plan of [...plans].sort((a, b) => (a.operation.end - a.operation.start) - (b.operation.end - b.operation.start))) {
    if (plan.closed !== undefined && plan.kind !== 'call') {
      const notify = closedNotifierOf(plan.closed);
      const operation = copy(plan.operation, replacements);
      if (plan.closed.kind !== 'edit') {
        replacements.set(plan.operation, expression('$$notify($$operation)', { notify, operation }));
        continue;
      }
      // `rows[i].label = x`: the item is held first, where the store would evaluate it, so the
      // edit can name it: `(_item = rows[i], _edited_rows(_item, _item.label = x))`.
      const target = editedMember(operation);
      if (target === null) {
        replacements.set(plan.operation, expression('$$notify($$all, $$operation)', {
          notify, all: editedItems(plan.closed.binding, names), operation,
        }));
        continue;
      }
      const held = names.fresh('_item');
      declarations.push(statement('var $$held;', { held }));
      const item = target.object;
      target.object = b.Identifier({ name: held });
      replacements.set(plan.operation, expression('($$held = $$item, $$notify($$held, $$operation))', {
        held, item, notify, operation,
      }));
      continue;
    }
    if (plan.kind === 'call' && plan.method !== undefined) {
      const notify = plan.closed === undefined ? notifierOf : () => closedNotifierOf(plan.closed!);
      emitKnownCall(plan, replacements, declarations, notify, names, runtime);
      continue;
    }
    if (plan.chained === true) {
      const call = copy(plan.operation, replacements);
      if (!is.CallExpression(call) || !is.MemberExpression(call.callee)) continue;

      const receiver = call.callee.object;
      const held = names.fresh('_receiver');
      const notify = notifierOf(plan.targets[0]!.binding);
      call.callee.object = b.Identifier({ name: held });

      // An `await` in the arguments cannot move into a function, so the receiver waits in a
      // variable instead. It is read before anything can suspend: the call takes it as `this`
      // ahead of its arguments, and the observation keeps its own copy.
      const suspends = findAll(plan.operation, 'AwaitExpression').length > 0 || findAll(plan.operation, 'YieldExpression').length > 0;
      if (suspends) {
        const observed = names.fresh('_held');
        declarations.push(statement('var $$held;', { held }));
        replacements.set(plan.operation, expression('($$held = $$receiver, (($$observed) => $$runtime.observeMutation([() => $$observed], [$$notify]))($$held).finish($$call))', {
          held, observed, runtime, notify, call, receiver,
        }));
      } else {
        replacements.set(plan.operation, expression('(($$held) => $$runtime.observeMutation([() => $$held], [$$notify]).finish($$call))($$receiver)', {
          held, runtime, notify, call, receiver,
        }));
      }
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

/** How many edits of a closed list's items have run, for its row lists to compare. */
function editCounter(binding: BindingNode, names: Names): string {
  return names.of(binding.binding.declarations[0]!, `_edits_${binding.binding.name}`);
}

/** Each edited item of a closed list, with the count of the edit that last changed it. */
function editedItems(binding: BindingNode, names: Names): string {
  return names.of(binding.binding.declarations[0]!, `_editedAt_${binding.binding.name}`);
}

/** The member a closed edit stores to (`rows[i].label` in `rows[i].label = x`), or null. */
function editedMember(operation: Node): Extract<Node, { type: 'MemberExpression' }> | null {
  const target = is.AssignmentExpression(operation) ? operation.left
    : is.UpdateExpression(operation) ? operation.argument
      : is.UnaryExpression(operation) && operation.operator === 'delete' ? operation.argument
        : null;
  return target !== null && is.MemberExpression(target) && !is.Super(target.object) ? target : null;
}

/**
 * Rows that read state outside the list skip only in a pass where that state is unchanged:
 * `whenQuiet` asks the site's computation, which keeps what it read (`core/emit/sites.ts`).
 */
function whenQuiet(outside: boolean, runtime: string, unedited: Expression): Expression {
  return outside ? expression('$$runtime.whenQuiet($$unedited)', { runtime, unedited }) : unedited;
}

/** The count a row list last evaluated its rows at; one per list instance (`emitRowList`). */
export function seenEdits(call: Node, names: Names): string {
  return names.of(call, '_seenEdits');
}

/**
 * A call the compiler knows the effect of (`MutationPlan.method`):
 *
 * - `read`: the authored call as written, or the row list or row cache that
 *   stands in for `map` or `Array.from` (`optimize/mapping-calls.ts`);
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
  // `Array.from(items, row)` iterates its first argument (`optimize/mapping-calls.ts`).
  const from = method.rowReuse?.form === 'from';
  const receiver = from ? call.arguments[0]! : call.callee.object;
  const callback = call.arguments[from ? 1 : 0]!;

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
    const moved = method.moved;
    const list = names.of(plan.operation, '_rowList');
    if (from) {
      // Closed-list proofs follow only `map` (`optimize/closed-lists.ts`), so nothing is skipped.
      replacements.set(plan.operation, expression('$$list.from($$receiver)', { list, receiver }));
      return;
    }
    replacements.set(plan.operation, moved === undefined
      ? expression('$$list.map($$receiver)', { list, receiver })
      : expression('$$list.map($$receiver, $$unedited)', {
        list: names.of(plan.operation, '_rowList'),
        receiver,
        unedited: whenQuiet(moved.outside, runtime, moved.edited
          ? expression('$$runtime.uneditedItems($$editedAt, $$seen, $$seen = $$edits)', {
            runtime, editedAt: editedItems(moved.binding, names),
            seen: seenEdits(plan.operation, names), edits: editCounter(moved.binding, names),
          })
          : expression('true')),
      }));
    return;
  }

  // One row cache per call site and owner instance (`runtime/src/list-map.ts`).
  const cache = names.fresh('_rows');
  declarations.push(statement(`const $$cache = $$runtime.createRowCache(${method.rowReuse!.usesIndex});`, { cache, runtime }));
  replacements.set(plan.operation, expression(from ? '$$runtime.fromRows($$receiver, $$cache, $$callback)' : '$$runtime.mapRows($$receiver, $$cache, $$callback)', {
    runtime,
    receiver,
    cache,
    callback,
  }));
}
