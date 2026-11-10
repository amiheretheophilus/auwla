/**
 * Callbacks commit as they return (`wiki/compiler/handlers.md`, "Callbacks").
 *
 * An event handler's writes commit when it returns, because its listener is wrapped
 * (`setListener`). A function that writes state and is handed to other code, such as a
 * subscription, a timer or a listener added with `addEventListener`, had no such
 * boundary: its writes waited for the recovery microtask, so code that called it and then
 * read the page saw the old value. The rule is that the UI updates at the end of each
 * callback, so these functions get the same boundary.
 *
 * The body is instrumented, not wrapped: `enterCallback()` first, `leaveCallback(value)` at
 * each return and at the end. The function keeps its identity (`removeEventListener(f)` still
 * finds it), its name, its length and its hoisting. A throw leaves the count to the recovery
 * microtask, as a throwing handler does; no `try` is added.
 *
 * Which functions:
 * - a function writes state if a planned write or mutation is in its own body, or it calls a
 *   function that does (`() => dismiss(id)`, where `dismiss` edits module state);
 * - it is handed out if it escapes (`core/resolve/escapes.ts`): passed, stored, returned,
 *   exported or a method. A function that is only called directly is part of its caller's
 *   stretch, which already has a boundary;
 * - not a component or a function holding its own state, whose bodies their own emitters build
 *   (`emitShared` rewrites the returns of the latter, and its copies would take this rewrite back),
 *   not an element's `on*` handler (already wrapped), not async (each `await` is a boundary,
 *   `core/emit/await.ts`) and not a generator.
 *
 * Inside a component's setup, render or effect the runtime does not commit at the end
 * (`leaveCallback`, `runtime/src/write-batch.ts`); a callback that runs there
 * (`items.forEach((item) => total += item)`) leaves its writes to that component's commit.
 */
import { b, is, walk } from 'yuku-ast';
import type { Module } from 'yuku-analyzer';
import type { Node, Statement } from 'yuku-parser';
import { findEscapingFunctions } from '../../core/resolve/escapes';
import { functionValue, type FunctionNode } from '../../core/resolve/functions';
import { expression, statement } from '../../core/emit/quote';
import { unwrap } from '../../core/plan/jsx';

/**
 * The functions of `module` that write state through `operations` and are handed out. `composed`
 * are functions whose body another emitter builds (components, functions holding their own state).
 */
export function planCallbackBoundaries(
  module: Module, operations: Iterable<Node>, composed: ReadonlySet<Node>,
): FunctionNode[] {
  const writers = new Set<FunctionNode>();
  for (const operation of operations) {
    const fn = enclosingFunction(module, operation);
    if (fn !== null) writers.add(fn);
  }
  // A function that calls a writer by name writes too. Repeat until nothing is added.
  const calls: { caller: FunctionNode; callee: FunctionNode }[] = [];
  for (const call of module.findAll(['CallExpression'])) {
    if (!is.CallExpression(call) || !is.Identifier(unwrap(call.callee))) continue;
    const callee = functionValue(module, unwrap(call.callee));
    const caller = callee === null ? null : enclosingFunction(module, call);
    if (callee !== null && caller !== null) calls.push({ caller, callee });
  }
  for (let added = true; added;) {
    added = false;
    for (const { caller, callee } of calls) {
      if (writers.has(callee) && !writers.has(caller)) {
        writers.add(caller);
        added = true;
      }
    }
  }
  return findEscapingFunctions(module).filter((fn) => {
    return writers.has(fn) && !composed.has(fn) && !fn.async && !fn.generator && !isElementHandler(module, fn);
  });
}

/**
 * Add the boundaries to `replacements`. Each replacement holds the authored nodes it
 * surrounds, so `copy` still applies the other features' replacements inside it.
 */
export function emitCallbackBoundaries(
  fns: readonly FunctionNode[], runtime: string, replacements: Map<Node, Node>,
): void {
  const leave = (value: Node | null) => value === null
    ? expression('$$runtime.leaveCallback()', { runtime })
    : expression('$$runtime.leaveCallback($$value)', { runtime, value });
  for (const fn of fns) {
    const body = fn.body;
    if (body === null) continue;
    if (!is.BlockStatement(body)) {
      // `() => count++`: the body may itself be a planned write, so replace the function.
      replacements.set(fn, { ...fn, body: leave(expression('($$runtime.enterCallback(), $$body)', { runtime, body })) } as Node);
      continue;
    }
    for (const node of ownReturns(body)) {
      replacements.set(node, b.ReturnStatement({ argument: leave(node.argument) }) as Node);
    }
    const directives = body.body.filter((entry) => is.ExpressionStatement(entry) && typeof entry.directive === 'string');
    replacements.set(body, b.BlockStatement({ body: [
      ...directives,
      statement('$$runtime.enterCallback();', { runtime }),
      ...body.body.slice(directives.length),
      // Falling off the end is a return too. After a `return` this line never runs.
      b.ExpressionStatement({ expression: leave(null) }) as Statement,
    ] as Statement[] }) as Node);
  }
}

/** The nearest function whose own body holds `node`. */
function enclosingFunction(module: Module, node: Node): FunctionNode | null {
  for (const ancestor of module.ancestors(node)) {
    if (ancestor !== node && is.Function(ancestor)) return ancestor as FunctionNode;
  }
  return null;
}

/** `<button onClick={() => …}>`: `setListener` already commits as it returns. */
function isElementHandler(module: Module, fn: FunctionNode): boolean {
  let container = module.parentOf(fn);
  while (container !== null && (is.ParenthesizedExpression(container) || is.TSAsExpression(container))) {
    container = module.parentOf(container);
  }
  if (!is.JSXExpressionContainer(container)) return false;
  const attribute = module.parentOf(container);
  if (!is.JSXAttribute(attribute) || !is.JSXIdentifier(attribute.name) || !attribute.name.name.startsWith('on')) return false;
  const element = module.parentOf(attribute);
  return is.JSXOpeningElement(element) && is.JSXIdentifier(element.name) && /^[a-z]/.test(element.name.name);
}

/** The returns of this function, not of a function nested in it. */
function ownReturns(body: Node): Extract<Node, { type: 'ReturnStatement' }>[] {
  const found: Extract<Node, { type: 'ReturnStatement' }>[] = [];
  walk(body, {
    enter(node, context) {
      if (is.Function(node)) context.skip();
      else if (is.ReturnStatement(node)) found.push(node);
    },
  });
  return found;
}
