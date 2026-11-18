/**
 * Calls whose callbacks may edit what they receive, and host calls whose result holds what they
 * were given. Shared by the handler plans (`features/handlers/plan.ts`), which decide what an
 * observation wraps, and the method lowering (`methods.ts`), which decides whether one is needed.
 */
import type { Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { effectFree, returnsArgumentValues } from './effects';
import { methodFact, redefinedNames, type MethodFact } from './method-facts';

type Call = Extract<Node, { type: 'CallExpression' }>;

/** A callback that runs during the call and can edit no object, so nothing needs observing. */
export function editsNoObject(module: Module, callback: Node): boolean {
  return effectFree(module, callback, { ownFunctions: true, nameWrites: true });
}

/** Every callback the known method `fact` runs is inline and edits no object. */
export function callbacksKnown(module: Module, call: Call, fact: MethodFact): boolean {
  return call.arguments.every((argument, index) => {
    if (is.SpreadElement(argument)) return fact.callback < 0;
    if (is.Function(argument)) return editsNoObject(module, argument);
    return index !== fact.callback;
  });
}

/** The parent of `node`, past `(x)`, `x!`, `x as T` and `x?.`, with the child it holds. */
function outerUse(module: Module, node: Node): { child: Node; parent: Node | null } {
  let child = node;
  let parent = module.parentOf(node);
  while (parent !== null && (is.ParenthesizedExpression(parent) || is.TSNonNullExpression(parent)
    || is.TSAsExpression(parent) || is.TSSatisfiesExpression(parent) || is.ChainExpression(parent))) {
    child = parent;
    parent = module.parentOf(parent);
  }
  return { child, parent };
}

/**
 * `Object.values(counters)` edits nothing, but its result holds `counters`' own objects, so
 * `Object.values(counters).forEach((c) => c.n++)` edits them through it, and nothing names
 * `counters` there. When what it returns is edited right where it is used, by a method whose
 * callback is not known to edit no object or through a member written or called
 * (`Object.values(x)[0].n = 1`), that whole use is what the observation wraps, so the edit
 * happens before it finishes. This returns that use, or null when the result is only read.
 *
 * Not covered: `for (const c of Object.values(counters)) c.n++`, whose edits are in a loop body
 * rather than one expression, and `[counters.a].forEach(…)`, whose array names no call at all
 * (`wiki/compiler/handlers.md`, "Edits through a call's result").
 */
export function editedUseOfResult(module: Module, call: Call): Node | null {
  if (!returnsArgumentValues(module, call)) return null;

  const { child, parent } = outerUse(module, call);
  if (!is.MemberExpression(parent) || parent.object !== child) return null;

  // A method called on the result: a known one whose callbacks edit no object only reads.
  const method = outerUse(module, parent);
  if (is.CallExpression(method.parent) && method.parent.callee === method.child) {
    const name = !parent.computed && is.Identifier(parent.property) ? parent.property.name : undefined;
    const fact = name === undefined ? undefined : methodFact(name);
    const reads = fact !== undefined && !redefinedNames(module).has(name!) && callbacksKnown(module, method.parent, fact);
    return reads ? null : method.parent;
  }

  // A member of the result: climb to the outermost, then see whether it is written or called.
  let chain: Node = parent;
  let use = outerUse(module, chain);
  while (is.MemberExpression(use.parent) && use.parent.object === use.child) {
    chain = use.parent;
    use = outerUse(module, chain);
  }
  if (chain === parent || use.parent === null) return null;
  const written = (is.AssignmentExpression(use.parent) && use.parent.left === use.child)
    || is.UpdateExpression(use.parent)
    || (is.UnaryExpression(use.parent) && use.parent.operator === 'delete')
    || (is.CallExpression(use.parent) && use.parent.callee === use.child);
  return written ? use.parent : null;
}
