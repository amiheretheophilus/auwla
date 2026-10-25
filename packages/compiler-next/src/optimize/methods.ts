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
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { ComponentPlan, ModulePlan, MutationPlan, SharedOwnerPlan } from '../core/plan/model';
import type { Optimization } from '.';

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

/**
 * Running `fn` makes no explicit call, construction, store outside its own
 * locals, deletion, iteration protocol use or suspension. What remains are
 * property reads and implicit conversions, which compiled code never observes,
 * and creating values: objects, functions (whose bodies do not run) and JSX.
 */
function effectFree(module: Module, fn: Node): boolean {
  if (!is.Function(fn) || fn.async || fn.generator) return false;
  const local = (target: Node): boolean => {
    if (!is.Identifier(target)) return false;
    const declaration = module.referenceOf(target)?.binding?.declarations[0];
    return declaration !== undefined && declaration.start >= fn.start && declaration.end <= fn.end;
  };
  let free = true;
  walk(fn, {
    enter: (node, ctx) => {
      if (node !== fn && is.Function(node)) {
        ctx.skip();
        return;
      }
      const effect = is.CallExpression(node) || is.NewExpression(node) || is.TaggedTemplateExpression(node)
        || is.ImportExpression(node) || is.AwaitExpression(node) || is.YieldExpression(node) || is.Class(node)
        || is.ForOfStatement(node) || is.ForInStatement(node) || is.ArrayPattern(node) || is.JSXSpreadChild(node)
        || (is.SpreadElement(node) && !is.ObjectExpression(ctx.parent))
        || (is.UnaryExpression(node) && node.operator === 'delete')
        || (is.AssignmentExpression(node) && !local(node.left))
        || (is.UpdateExpression(node) && !local(node.argument));
      if (effect) {
        free = false;
        ctx.stop();
      }
    },
  });
  return free;
}

function provenCallbacks(module: Module, operation: Node): number {
  let proven = 0;
  if (!is.CallExpression(operation)) return proven;
  operation.arguments.forEach((argument, index) => {
    if (index < 31 && effectFree(module, argument)) proven |= 1 << index;
  });
  return proven;
}

function lowered(module: Module, plans: readonly MutationPlan[]): readonly MutationPlan[] {
  let changed = false;
  const next = plans.map((plan) => {
    if (plan.kind !== 'call' || plan.method !== undefined || !plainMemberCall(plan.operation)) return plan;
    changed = true;
    return { ...plan, method: { provenCallbacks: provenCallbacks(module, plan.operation) } };
  });
  return changed ? next : plans;
}

function loweredOwner<T extends ComponentPlan | SharedOwnerPlan>(module: Module, owner: T): T {
  const mutations = lowered(module, owner.mutations);
  const replayMutations = lowered(module, owner.replayMutations);
  return mutations === owner.mutations && replayMutations === owner.replayMutations
    ? owner
    : { ...owner, mutations, replayMutations };
}

export const methodCalls: Optimization = {
  name: 'method-calls',
  match(general: ModulePlan): ModulePlan | null {
    const module = general.module.module;
    let changed = false;
    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      const next = loweredOwner(module, component);
      if (next !== component) {
        changed = true;
        components.set(fn, next);
      }
    }
    const sharedOwners = general.sharedOwners.map((owner) => {
      const next = loweredOwner(module, owner);
      changed ||= next !== owner;
      return next;
    });
    return changed ? { ...general, components, sharedOwners } : null;
  },
};
