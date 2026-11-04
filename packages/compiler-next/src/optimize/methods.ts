/**
 * Member calls whose method name the compiler knows (`method-facts.ts`). The
 * decision is made here and nothing checks it at runtime:
 *
 * - a method that only reads stays a plain call with no observation. A callback
 *   it runs must be inline and effect-free, because a callback can edit the items
 *   it receives; any other callback keeps the general observation.
 * - a method that edits its receiver runs natively, then reports the receiver's
 *   root (`editArray` in `runtime/src/mutation.ts`).
 *
 * An unlisted method, or one the module redefines, keeps the general observation.
 */
import type { Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { ComponentPlan, ModulePlan, MutationPlan, SharedOwnerPlan } from '../core/plan/model';
import type { SemanticGraph } from '../core/graph';
import type { Optimization } from '.';
import { effectFree } from './effects';
import { methodFact, redefinedNames, type MethodFact } from './method-facts';
import { rowReuse } from './row-reuse';

type Call = Extract<Node, { type: 'CallExpression' }>;
type Member = Extract<Node, { type: 'MemberExpression' }>;

/** `receiver.name(…)`, the only shape a method name can decide. */
function namedCallee(call: Call): (Member & { property: { name: string } }) | null {
  const callee = call.callee;
  if (!is.MemberExpression(callee) || callee.computed || is.Super(callee.object)
    || !is.Identifier(callee.property)) return null;
  return callee as Member & { property: { name: string } };
}

/** An optional link can skip the call, so an edit report must keep it. */
function shortCircuits(node: Node): boolean {
  if (is.MemberExpression(node)) return node.optional || shortCircuits(node.object);
  if (is.CallExpression(node)) return node.optional || shortCircuits(node.callee);
  if (is.TSNonNullExpression(node)) return shortCircuits(node.expression);
  return false;
}

/** Rooted in a host global or an import: an object this module knows nothing about. */
function foreignObject(module: Module, object: Node): boolean {
  let root = object;
  while (is.MemberExpression(root) || is.TSNonNullExpression(root) || is.ParenthesizedExpression(root)) {
    root = is.MemberExpression(root) ? root.object : root.expression;
  }
  if (!is.Identifier(root)) return false;

  const binding = module.referenceOf(root)?.binding ?? null;
  return binding === null || module.imports.some((imported) => imported.local === binding);
}

function callbacksKnown(module: Module, call: Call, fact: MethodFact): boolean {
  return call.arguments.every((argument, index) => {
    if (is.SpreadElement(argument)) return fact.callback < 0;
    if (is.Function(argument)) return effectFree(module, argument, { ownFunctions: true });
    return index !== fact.callback;
  });
}

function lowerCall(
  plan: MutationPlan,
  general: ModulePlan,
  graph: SemanticGraph,
): MutationPlan {
  if (plan.kind !== 'call' || plan.method !== undefined || !is.CallExpression(plan.operation)) return plan;

  const call = plan.operation;
  const callee = namedCallee(call);
  if (callee === null) return plan;

  const module = general.module.module;
  const name = callee.property.name;
  const fact = methodFact(name);
  if (fact === undefined || redefinedNames(module).has(name) || !callbacksKnown(module, call, fact)) return plan;

  // A known method reads its arguments and edits at most its receiver. So with
  // no reactive receiver (`buildData(1).concat(items)`, `out.push(item)`) nothing
  // reactive changes, unless the receiver is a library's namespace, whose `map`
  // or `fill` can do anything with what it receives (`_.fill(items, 0)`).
  const receivers = plan.targets.filter(({ member }) => member.start >= callee.start && member.end <= callee.end);
  if (receivers.length === 0) {
    return foreignObject(module, callee.object) ? plan : { ...plan, method: { kind: 'read' } };
  }

  // Source flow already replaced this call with its readiness wrapper, around
  // the authored call: a read stays inside it, an edit keeps the general form.
  const wrapped = wrappedBySources(general, call);

  if (fact.kind === 'edit') {
    if (wrapped || shortCircuits(callee) || call.optional) return plan;
    return { ...plan, targets: receivers, method: { kind: 'edit' } };
  }

  // The row cache and row list stand in for `map` itself.
  const callback = call.arguments.length === 1 ? call.arguments[0] : undefined;
  const rows = name === 'map' && !wrapped && callback !== undefined && !call.optional && !shortCircuits(callee)
    ? rowReuse(general, graph, callback)
    : null;
  return { ...plan, method: { kind: 'read', ...(rows === null ? {} : { rowReuse: rows }) } };
}

function wrappedBySources(general: ModulePlan, call: Call): boolean {
  const flow = general.sourceFlow;
  if (flow === undefined) return false;
  return flow.presented.has(call) || flow.guards.has(call) || flow.retained.has(call)
    || flow.calls.some((entry) => entry.call === call);
}

function lowered(plans: readonly MutationPlan[], general: ModulePlan, graph: SemanticGraph): readonly MutationPlan[] {
  let changed = false;
  const next = plans.map((plan) => {
    const lower = lowerCall(plan, general, graph);
    changed ||= lower !== plan;
    return lower;
  });
  return changed ? next : plans;
}

function loweredOwner<T extends ComponentPlan | SharedOwnerPlan>(owner: T, general: ModulePlan, graph: SemanticGraph): T {
  const mutations = lowered(owner.mutations, general, graph);
  const replayMutations = lowered(owner.replayMutations, general, graph);
  return mutations === owner.mutations && replayMutations === owner.replayMutations
    ? owner
    : { ...owner, mutations, replayMutations };
}

export const methodCalls: Optimization = {
  name: 'method-calls',
  match(general: ModulePlan, graph: SemanticGraph): ModulePlan | null {
    let changed = false;
    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      const next = loweredOwner(component, general, graph);
      if (next !== component) {
        changed = true;
        components.set(fn, next);
      }
    }
    const sharedOwners = general.sharedOwners.map((owner) => {
      const next = loweredOwner(owner, general, graph);
      changed ||= next !== owner;
      return next;
    });
    return changed ? { ...general, components, sharedOwners } : null;
  },
};
