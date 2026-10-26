/** Source lifetimes use the data runtime; recomputation stays in ordinary memos. */
import { b } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { ComponentSourcesPlan, SourcePrerequisite } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement, statements } from '../../core/emit/quote';

interface SourceEmitContext {
  readonly versions: ReadonlyMap<BindingNode, string>;
  readonly takeoverFlags: ReadonlyMap<BindingNode, string>;
  readonly names: Names;
  readonly data: string;
  readonly runtime: string;
  readonly owner: string;
  readonly batch: string;
  readonly scope: string;
  readonly replacements: ReadonlyMap<Node, Node>;
}

export function emitSources(
  plan: ComponentSourcesPlan | undefined,
  context: SourceEmitContext,
) {
  const { names, data, runtime } = context;
  const replacements = new Map(context.replacements);
  const declarations: Statement[] = [];
  const values = new Map<BindingNode, Expression>();
  const changed = new Map<BindingNode, Expression>();
  const mutations = { values, changed };

  if (plan === undefined) {
    return { replacements, declarations, mutations };
  }

  // A request may settle while another application is active. Its notification
  // must still enter the application that created this component.
  const application = names.fresh('_sourceApplication');

  declarations.push(statement('const $$application = $$runtime.getActiveApplicationRuntime();', {
    application,
    runtime,
  }));

  const initialized = new Map<BindingNode, string>();

  for (const source of plan.bindings) {
    initialized.set(source.binding, names.fresh('_sourceInitialized'));
  }

  for (const source of plan.bindings) {
    const emitted = emitSourceBinding(source, initialized.get(source.binding)!, application, context);

    declarations.push(...emitted.declarations);
    replacements.set(source.call, emitted.value);

    // Mutation observation must inspect the authored object. The resource is
    // only a handle; editing its payload does not change the handle itself.
    values.set(source.binding, expression('$$data.resolvedValueSnapshot($$binding).data', {
      data,
      binding: source.binding.binding.name,
    }));

    changed.set(source.binding, expression('$$data.notifyResolvedValueMutation($$binding)', {
      data,
      binding: source.binding.binding.name,
    }));
  }

  for (const node of plan.payloadReads) {
    replacements.set(node, expression('$$data.readResolvedValue($$value)', {
      data,
      value: copy(node, context.replacements),
    }));
  }

  for (const [root, guard] of plan.guards) {
    const value = copy(root, replacements);
    const ready = readinessCondition(guard.inputs, initialized, context);
    let guarded = expression('$$ready ? $$value : void 0', { ready, value });

    if (guard.render) {
      const sources = activeSources(guard.inputs, context);

      guarded = expression(`
        $$data.resolvedValuesError($$sources) !== null
          ? $$data.throwResolvedValuesError($$sources)
          : $$guarded
      `, { data, sources, guarded });
    }

    replacements.set(root, guarded);
  }

  return { replacements, declarations, mutations };
}

function emitSourceBinding(
  source: ComponentSourcesPlan['bindings'][number],
  started: string,
  application: string,
  context: SourceEmitContext,
) {
  const { names, data, runtime, owner, batch, scope } = context;
  const { binding, call, read } = source;
  const bind = names.fresh('_bindSource');
  const factory = names.fresh('_createSource');
  const value = names.fresh('_source');

  // Rebinding keeps the resource identity and committed payload. Register its
  // cleanup immediately, before any later component setup can fail.
  const declarations = statements(`
    let $$started = false;

    function $$bind($$factory) {
      if ($$started) {
        $$data.rebindResolvedValueFromFactory($$binding, $$factory);

        return $$binding;
      }

      const $$value = $$factory();

      $$runtime.ownCleanup($$owner, $$data.connectResolvedValue($$value, () => {
        $$runtime.runWithApplicationRuntime($$application, () => {
          $$version++;

          if (!$$scope.building()) {
            $$batch.mark();
          }
        });
      }));

      $$started = true;

      return $$value;
    }
  `, {
    started,
    bind,
    factory,
    data,
    binding: binding.binding.name,
    value,
    runtime,
    owner,
    application,
    version: context.versions.get(binding)!,
    scope,
    batch,
  });

  const created = copy(call, context.replacements);

  // A retry repeats the authored promise expression. It does not reuse the
  // rejected promise from the source's first execution.
  if (read && created.arguments.length === 1) {
    created.arguments.push(expression('() => $$promise', {
      promise: copy(call.arguments[0]!, context.replacements),
    }));
  }

  return {
    declarations,
    value: expression('$$bind(() => $$created)', { bind, created }),
  };
}

function readinessCondition(
  inputs: readonly SourcePrerequisite[],
  initialized: ReadonlyMap<BindingNode, string>,
  context: SourceEmitContext,
): Expression {
  let ready = expression('true');

  for (const { source, unlessTaken } of inputs) {
    // A chained declaration can hold undefined while its request arguments
    // wait. The flag distinguishes that from a source resolving to undefined.
    // Reading the binding first also preserves native temporal-dead-zone errors.
    let condition = expression('$$data.resolvedValueSnapshot($$binding).status === "success" && $$started', {
      started: initialized.get(source)!,
      data: context.data,
      binding: source.binding.name,
    });

    for (const binding of unlessTaken) {
      const taken = context.takeoverFlags.get(binding);

      if (taken !== undefined) {
        condition = expression('$$taken || ($$condition)', { taken, condition });
      }
    }

    ready = b.LogicalExpression({ operator: '&&', left: ready, right: condition });
  }

  return ready;
}

function activeSources(
  inputs: readonly SourcePrerequisite[],
  context: SourceEmitContext,
): Expression {
  const elements: Extract<Node, { type: 'ArrayExpression' }>['elements'] = [];

  for (const { source, unlessTaken } of inputs) {
    let active = expression('true');

    for (const binding of unlessTaken) {
      const taken = context.takeoverFlags.get(binding);

      if (taken !== undefined) {
        active = expression('$$active && !$$taken', { active, taken });
      }
    }

    const values = expression('$$active ? [$$binding] : []', {
      active,
      binding: source.binding.name,
    });

    elements.push(b.SpreadElement({ argument: values }));
  }

  return b.ArrayExpression({ elements });
}
