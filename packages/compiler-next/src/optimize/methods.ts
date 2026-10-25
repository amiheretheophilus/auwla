/**
 * Lower observed member calls to `observeMethod`, so the runtime can skip the
 * snapshot when it proves the actual callee (`runtime/src/method-calls.ts`).
 *
 * Nothing here reads a method name. The pass selects every plain member call
 * the general path observes and records which inline callback arguments make
 * no explicit effect. The runtime proof keys on the callee's identity; an
 * unknown, overridden or custom method keeps the general before/after check.
 */
import type { Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { ComponentPlan, ModulePlan, MutationPlan, SharedOwnerPlan } from '../core/plan/model';
import type { SemanticGraph } from '../core/graph';
import type { Optimization } from '.';
import { effectFree } from './effects';
import { rowReuse } from './row-reuse';

/**
 * A member call the lowering can evaluate in native order: receiver, key,
 * method read, arguments, call. An optional link anywhere in the callee chain
 * could skip the call entirely, and spread arguments run an iterator while
 * arguments are evaluated; both keep the general form.
 */
function plainMemberCall(operation: Node): boolean {
  if (!is.CallExpression(operation) || operation.optional) return false;
  const callee = operation.callee;
  if (!is.MemberExpression(callee) || is.Super(callee.object) || is.PrivateIdentifier(callee.property)) return false;
  if (operation.arguments.some((argument) => is.SpreadElement(argument))) return false;
  return !shortCircuits(callee);
}

function shortCircuits(node: Node): boolean {
  if (is.MemberExpression(node)) return node.optional || shortCircuits(node.object);
  if (is.CallExpression(node)) return node.optional || shortCircuits(node.callee);
  if (is.TSNonNullExpression(node)) return shortCircuits(node.expression);
  // A ChainExpression or parentheses end the chain: their value is used as is.
  return false;
}

/** Bit `i` set when argument `i` is an inline function whose body has no explicit effect. */
function provenCallbacks(module: Module, operation: Node): number {
  let proven = 0;
  if (!is.CallExpression(operation)) return proven;
  operation.arguments.forEach((argument, index) => {
    if (index < 31 && is.Function(argument) && effectFree(module, argument)) proven |= 1 << index;
  });
  return proven;
}

type Lower = (operation: Node) => NonNullable<MutationPlan['method']>;

function lowered(plans: readonly MutationPlan[], lower: Lower): readonly MutationPlan[] {
  let changed = false;
  const next = plans.map((plan) => {
    if (plan.kind !== 'call' || plan.method !== undefined || !plainMemberCall(plan.operation)) return plan;
    changed = true;
    return { ...plan, method: lower(plan.operation) };
  });
  return changed ? next : plans;
}

function loweredOwner<T extends ComponentPlan | SharedOwnerPlan>(owner: T, lower: Lower): T {
  const mutations = lowered(owner.mutations, lower);
  const replayMutations = lowered(owner.replayMutations, lower);
  return mutations === owner.mutations && replayMutations === owner.replayMutations
    ? owner
    : { ...owner, mutations, replayMutations };
}

export const methodCalls: Optimization = {
  name: 'method-calls',
  match(general: ModulePlan, graph: SemanticGraph): ModulePlan | null {
    const module = general.module.module;
    const lower: Lower = (operation) => {
      const callback = is.CallExpression(operation) ? operation.arguments[0] : undefined;
      const rows = callback === undefined ? null : rowReuse(general, graph, callback);
      return { provenCallbacks: provenCallbacks(module, operation), ...(rows === null ? {} : { rowReuse: rows }) };
    };
    let changed = false;
    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      const next = loweredOwner(component, lower);
      if (next !== component) {
        changed = true;
        components.set(fn, next);
      }
    }
    const sharedOwners = general.sharedOwners.map((owner) => {
      const next = loweredOwner(owner, lower);
      changed ||= next !== owner;
      return next;
    });
    return changed ? { ...general, components, sharedOwners } : null;
  },
};
