/** Source holders reuse component storage and the ordinary memo engine. */
import { is } from 'yuku-ast';
import type { BindingNode, SemanticGraph } from '../../core/graph';
import { variableDeclaration, type InputQueries } from '../../core/graph/inputs';
import type { ComponentPlan, ComponentSourcesPlan, MemoGroupPlan } from '../../core/plan/model';
import { unwrap } from '../../core/plan/jsx';

export function planSourceMemos(
  memos: readonly MemoGroupPlan[],
  sources: ComponentSourcesPlan,
  graph: SemanticGraph,
  queries: InputQueries,
): readonly MemoGroupPlan[] {
  const bindings = new Set(sources.bindings.map((source) => source.binding));

  return memos.map((group) => {
    const inputs = new Set(group.inputs);
    const computations = group.computations.map((memo) => {
      const source = sources.bindings.find((source) => memo.targets.includes(source.binding));

      if (source === undefined) {
        return memo;
      }

      const requestInputs = new Set<BindingNode>();
      const module = source.binding.binding.module;

      // Payload builders can depend on other state. Only the factory's own
      // inputs may restart its request; settlement wakes the group separately.
      for (const read of queries.inputsOf(module, source.call).reads) {
        const binding = read.binding ?? read.reference.binding;
        const input = binding === null ? undefined : graph.bindings.get(binding);

        if (input !== undefined && !memo.targets.includes(input)) {
          requestInputs.add(input);
        }
      }

      return { ...memo, initializerInputs: [...requestInputs] };
    });

    for (const memo of group.computations) {
      for (const target of memo.targets) {
        if (bindings.has(target)) {
          inputs.add(target);
        }
      }
    }

    return { ...group, inputs: [...inputs], computations };
  });
}

export function planSources(component: ComponentPlan): ComponentSourcesPlan | undefined {
  const bindings = component.state.flatMap((binding) => {
    const declaration = variableDeclaration(binding.binding);
    const call = declaration?.init == null ? null : unwrap(declaration.init);

    if (binding.kind !== 'Source' || declaration === null || !is.Identifier(declaration.id)
      || !is.CallExpression(call)) {
      return [];
    }

    return [{ binding, call }];
  });

  if (bindings.length === 0) {
    return undefined;
  }

  return { bindings };
}
