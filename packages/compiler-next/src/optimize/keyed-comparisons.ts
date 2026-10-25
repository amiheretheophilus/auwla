/**
 * Strict comparisons with shared state become keyed reads (`runtime`'s
 * `trackEquals`). In `selected === row.id`, a change of `selected` from `a` to
 * `b` can flip the result only where `row.id` is `a` or `b`; every other reader
 * of `selected` through such a comparison stays asleep. Selecting one of 10k
 * rows then wakes two rows instead of all of them.
 *
 * Proof conditions: the operator is `===` or `!==`, which never converts; the
 * left operand is a plain reference to a shared binding owned by this module, so
 * it is read first as written; the right operand has no explicit effect
 * (`effects.ts`) and does not read that binding. Anything else keeps the plain
 * read, which wakes the reader on every change.
 */
import { findAll, is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode } from '../core/graph';
import type { ModulePlan } from '../core/plan/model';
import type { Optimization } from '.';
import { effectFree } from './effects';

export const keyedComparisons: Optimization = {
  name: 'keyed-comparisons',
  match(general: ModulePlan): ModulePlan | null {
    const module = general.module.module;
    const comparisons = new Map<Node, BindingNode>();
    for (const read of general.sharedReads.values()) {
      const binding = read.binding.binding;
      if (binding.module !== module) continue;
      for (const reference of binding.references) {
        if (reference.isWrite || reference.inTypePosition) continue;
        const parent = module.parentOf(reference.node);
        if (!is.BinaryExpression(parent) || (parent.operator !== '===' && parent.operator !== '!==')) continue;
        if (parent.left !== reference.node || !effectFree(module, parent.right)) continue;
        const readsBinding = findAll(parent.right, 'Identifier')
          .some((node) => module.referenceOf(node)?.binding === binding);
        if (!readsBinding) comparisons.set(parent, read.binding);
      }
    }
    return comparisons.size === 0 ? null : { ...general, keyedComparisons: comparisons };
  },
};
