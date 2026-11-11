/**
 * Member calls whose method name the compiler knows (`method-facts.ts`). The
 * decision is made here and nothing checks it at runtime:
 *
 * - a method that only reads stays a plain call with no observation. A callback
 *   it runs must be inline and edit no object, because a callback can edit the items
 *   it receives; any other callback keeps the general observation. Writing a plain
 *   name is allowed (`total += row.price`): it edits no object and reports itself.
 * - a method that edits its receiver runs natively, then reports the receiver's
 *   root (`editArray` in `runtime/src/mutation.ts`).
 *
 * An unlisted method, or one the module redefines, keeps the general observation.
 */
import type { Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { intrinsicTag, unwrap } from '../core/plan/jsx';
import type { ComponentPlan, MemoGroupPlan, ModulePlan, MutationPlan, SharedOwnerPlan } from '../core/plan/model';
import type { BindingNode, SemanticGraph } from '../core/graph';
import type { Optimization } from '.';
import { callEditsNoArgument, callOnlyStoresNames, effectFree, isReadingIntrinsic, runsDuringCall } from './effects';
import { mappingCall, type MappingForm } from './mapping-calls';
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

/** `let el;`, never written: the name starts out holding nothing. */
function declaredEmpty(module: Module, name: Node): boolean {
  const declarator = module.parentOf(name);
  if (!is.VariableDeclarator(declarator) || declarator.id !== name) return false;
  const init = declarator.init;
  return init === null || (is.Literal(init) && init.value === null) || (is.Identifier(init) && init.name === 'undefined');
}

/**
 * Whether a binding can only ever hold a DOM node or nothing: declared empty, never
 * written, and only ever given as `ref={name}` on a host element. A component's `ref` is
 * an ordinary prop, which could store anything there. Observing such a binding finds
 * nothing, because a mutation snapshot does not look inside a ref's node.
 */
function holdsOnlyNodes(module: Module, node: BindingNode): boolean {
  const { binding } = node;
  const name = binding.declarations[0];
  if (node.kind !== 'Ref' || name === undefined || binding.declarations.length !== 1 || !declaredEmpty(module, name)) return false;
  if (binding.references.some((reference) => reference.isWrite)) return false;

  return module.findAll('JSXAttribute').every((attribute) => {
    if (!is.JSXIdentifier(attribute.name) || attribute.name.name !== 'ref' || !is.JSXExpressionContainer(attribute.value)) return true;
    const value = attribute.value.expression;
    const mentions = binding.references.some((reference) => reference.node.start >= value.start && reference.node.end <= value.end);
    if (!mentions) return true;
    const element = module.parentOf(module.parentOf(attribute) as Node);
    return is.Identifier(unwrap(value)) && element !== null && is.JSXElement(element) && intrinsicTag(element) !== null;
  });
}

/**
 * `tracked.refresh()`, with `const tracked = $track(source)` never written: the method is the
 * data package's, and what it changes reaches the page through the handle's tracked reads.
 * Only a method of the handle itself: `tracked.data.push(1)` edits the payload.
 */
function callsTrackedHandle(module: Module, call: Call): boolean {
  const callee = unwrap(call.callee);
  if (!is.MemberExpression(callee) || !is.Identifier(callee.object)) return false;

  const binding = module.referenceOf(callee.object)?.binding ?? null;
  const name = binding?.declarations[0];
  if (binding === null || name === undefined || binding.references.some((reference) => reference.isWrite)) return false;

  const declarator = module.parentOf(name);
  if (!is.VariableDeclarator(declarator) || declarator.id !== name || declarator.init === null) return false;

  const init = unwrap(declarator.init);
  return is.CallExpression(init) && is.Identifier(init.callee) && isReadingIntrinsic(module, init.callee)
    && call.arguments.length === 0;
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

/** A callback that runs during the call and can edit no object, so nothing needs observing. */
function editsNoObject(module: Module, callback: Node): boolean {
  return effectFree(module, callback, { ownFunctions: true, nameWrites: true });
}

function callbacksKnown(module: Module, call: Call, fact: MethodFact): boolean {
  return call.arguments.every((argument, index) => {
    if (is.SpreadElement(argument)) return fact.callback < 0;
    if (is.Function(argument)) return editsNoObject(module, argument);
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
  if (callEditsNoArgument(general.module.module, call)
    && call.arguments.every((argument) => !is.Function(argument) || editsNoObject(general.module.module, argument) || !runsDuringCall(call))) {
    // `Array.from(items, row)` reads its items like `map` does.
    return withRowReuse(plan, general, graph, call, 'from');
  }

  if (callOnlyStoresNames(general.module.module, call)) return { ...plan, method: { kind: 'read' } };

  // `el?.focus()`: a call on a node can only change the page, which observing never saw.
  if (plan.targets.length > 0 && plan.targets.every((target) => holdsOnlyNodes(general.module.module, target.binding))) {
    return { ...plan, method: { kind: 'read' } };
  }

  if (callsTrackedHandle(general.module.module, call)) return { ...plan, method: { kind: 'read' } };

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
  if (receivers.length < plan.targets.length && foreignObject(module, callee.object)) return plan;
  if (receivers.length === 0) return { ...plan, method: { kind: 'read' } };

  // Source flow already replaced this call with its readiness wrapper, around
  // the authored call: a read stays inside it, an edit keeps the general form.
  const wrapped = wrappedBySources(general, call);

  if (fact.kind === 'edit') {
    // More than one root for one receiver: it is reached through a getter (`planMutations`), and the
    // known edit reports only to the first. The general form watches them all.
    if (wrapped || shortCircuits(callee) || call.optional || receivers.length > 1) return plan;
    return { ...plan, targets: receivers, method: { kind: 'edit' } };
  }

  return withRowReuse(plan, general, graph, call, 'map');
}

/**
 * A read, where the row cache and row list may stand in for the mapping call
 * itself (`mapping-calls.ts`, `row-reuse.ts`). Not where source flow wrapped
 * the call, or an optional link can skip it.
 */
function withRowReuse(plan: MutationPlan, general: ModulePlan, graph: SemanticGraph, call: Call, form: MappingForm): MutationPlan {
  const mapping = mappingCall(general.module.module, call);
  const rows = mapping !== null && mapping.form === form && !wrappedBySources(general, call) && !shortCircuits(call)
    ? rowReuse(general, graph, mapping.callback)
    : null;
  return { ...plan, method: { kind: 'read', ...(rows === null ? {} : { rowReuse: { ...rows, form } }) } };
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

/**
 * Whether this write runs after the step, in a callback a timer was given. It builds
 * nothing, since the step has finished by then, and it reports itself.
 */
function runsAfterStep(module: Module, write: Node, step: Node): boolean {
  for (const ancestor of module.ancestors(write)) {
    if (ancestor === step) return false;
    if (!is.Function(ancestor)) continue;
    const parent = module.parentOf(ancestor);
    if (parent !== null && is.CallExpression(parent) && !runsDuringCall(parent)) return true;
  }
  return false;
}

/**
 * A step that can edit nothing, and writes none of the values it was suspected of
 * building while it runs. `visible = notes.filter((n) => n.title.includes(q))` cannot
 * change `q`, and `setInterval(tick)` runs nothing yet. `rows.forEach((row) => { total +=
 * row.n; })` does build `total`.
 */
function buildsNothing(module: Module, step: Node, suspected: readonly BindingNode[]): boolean {
  if (!effectFree(module, step, { nameWrites: true, hostCalls: true })) return false;

  return suspected.every(({ binding }) => binding.references.every((reference) => {
    const inStep = reference.node.start >= step.start && reference.node.end <= step.end;
    return !reference.isWrite || !inStep || runsAfterStep(module, reference.node, step);
  }));
}

/**
 * Observing a step that builds nothing could never find a change. The plan stays as it
 * is, so what waits for the step still waits (`wiki/decisions.md`, 2026-11-05) and a value
 * it was suspected of building stays undecided for good, as it would have anyway.
 */
function withoutIdleObservation(groups: readonly MemoGroupPlan[], module: Module): readonly MemoGroupPlan[] {
  let changed = false;
  const next = groups.map((group) => {
    const idle = [...group.possibleOutputs].filter(([step, suspected]) => buildsNothing(module, step, suspected));
    if (idle.length === 0) return group;
    changed = true;
    return { ...group, idleBuilders: new Set(idle.map(([step]) => step)) };
  });
  return changed ? next : groups;
}

function loweredOwner<T extends ComponentPlan | SharedOwnerPlan>(owner: T, general: ModulePlan, graph: SemanticGraph): T {
  const mutations = lowered(owner.mutations, general, graph);
  const replayMutations = lowered(owner.replayMutations, general, graph);
  const memos = withoutIdleObservation(owner.memos, general.module.module);
  return mutations === owner.mutations && replayMutations === owner.replayMutations && memos === owner.memos
    ? owner
    : { ...owner, mutations, replayMutations, memos };
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
