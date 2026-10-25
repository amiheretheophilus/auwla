/**
 * Strict comparisons with shared state become keyed reads (`runtime`'s
 * `trackEquals`). In `selected === row.id`, a change of `selected` from `a` to
 * `b` can flip the result only where `row.id` is `a` or `b`; every other reader
 * of `selected` through such a comparison stays asleep. Selecting one of 10k
 * rows then wakes two rows instead of all of them.
 *
 * Proof conditions: the operator is `===` or `!==`, which never converts; the
 * left operand is a plain reference to a shared binding owned by this module, or
 * a component binding at a read the plan tracks (`trackedReads`, as in a row
 * callback), so it is read first as written; the right operand has no explicit effect
 * (`effects.ts`) and does not read that binding. Anything else keeps the plain
 * read, which wakes the reader on every change.
 */
import type { Binding, Module } from 'yuku-analyzer';
import { findAll, is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode } from '../core/graph';
import type { ModulePlan } from '../core/plan/model';
import type { Optimization } from '.';
import { effectFree } from './effects';

/** The comparison `node` is the left operand of, if it qualifies. */
function keyedComparison(module: Module, node: Node, binding: Binding): Node | null {
  const parent = module.parentOf(node);
  if (!is.BinaryExpression(parent) || (parent.operator !== '===' && parent.operator !== '!==')) return null;
  if (parent.left !== node || !effectFree(module, parent.right)) return null;
  const readsBinding = findAll(parent.right, 'Identifier')
    .some((identifier) => module.referenceOf(identifier)?.binding === binding);
  return readsBinding ? null : parent;
}

export const keyedComparisons: Optimization = {
  name: 'keyed-comparisons',
  match(general: ModulePlan): ModulePlan | null {
    const module = general.module.module;
    // Shared bindings of this module, read through their readers.
    const comparisons = new Map<Node, BindingNode>();
    for (const read of general.sharedReads.values()) {
      const binding = read.binding.binding;
      if (binding.module !== module) continue;
      for (const reference of binding.references) {
        if (reference.isWrite || reference.inTypePosition) continue;
        const comparison = keyedComparison(module, reference.node, binding);
        if (comparison !== null) comparisons.set(comparison, read.binding);
      }
    }
    // Component bindings read through `trackRead`, as in a row callback.
    let changed = comparisons.size > 0;
    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      const local = new Map<Node, BindingNode>();
      for (const read of component.trackedReads) {
        const comparison = keyedComparison(module, read.node, read.binding.binding);
        if (comparison !== null) local.set(comparison, read.binding);
      }
      if (local.size > 0) {
        changed = true;
        components.set(fn, { ...component, keyedComparisons: local });
      }
    }
    if (!changed) return null;
    return { ...general, components, ...(comparisons.size > 0 ? { keyedComparisons: comparisons } : {}) };
  },
};
