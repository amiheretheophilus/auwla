/** Authored payload edits use the same observer and publication as ordinary edits. */
import type { Expression } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { ComponentSourcesPlan } from '../../core/plan/model';
import { expression } from '../../core/emit/quote';

export function emitSources(plan: ComponentSourcesPlan | undefined, data: string) {
  const values = new Map<BindingNode, Expression>();
  const changed = new Map<BindingNode, Expression>();

  for (const source of plan?.bindings ?? []) {
    const binding = source.binding.binding.name;

    values.set(source.binding, expression('$$data.resolvedValueSnapshot($$binding).data', {
      data,
      binding,
    }));

    changed.set(source.binding, expression('$$data.notifyResolvedValueMutation($$binding)', {
      data,
      binding,
    }));
  }

  return { values, changed };
}
