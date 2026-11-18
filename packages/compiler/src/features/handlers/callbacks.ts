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
 * The body is instrumented, not wrapped: `enterCallback()` first, `leaveCallback(value)` where it
 * ends (`emitCallbackBoundaries`: after a `finally`, at an async function's first `await`). The
 * function keeps its identity (`removeEventListener(f)` still finds it), its name, its length and
 * its hoisting. A throw leaves the count to the recovery microtask, as a throwing handler does; no
 * `try` is added.
 *
 * Which functions:
 * - a function writes state if a planned write or mutation is in its own body, or it calls a
 *   function that does (`() => dismiss(id)`, where `dismiss` edits module state);
 * - it is handed out if it escapes (`core/resolve/escapes.ts`): passed, stored, returned,
 *   exported or a method. A function that is only called directly is part of its caller's
 *   stretch, which already has a boundary;
 * - not a component or a function holding its own state, whose bodies their own emitters build
 *   (`emitShared` rewrites the returns of the latter, and its copies would take this rewrite back),
 *   not an element's `on*` handler (already wrapped) and not a generator. An async function ends
 *   its synchronous stretch at its first `await` (`emitCallbackBoundaries`).
 *
 * Inside a component's setup, render or effect the runtime does not commit at the end
 * (`leaveCallback`, `runtime/src/write-batch.ts`); a callback that runs there
 * (`items.forEach((item) => total += item)`) leaves its writes to that component's commit.
 */
import { b, is, walk } from 'yuku-ast';
import type { Module } from 'yuku-analyzer';
import type { Expression, Node, Statement } from 'yuku-parser';
import { findEscapingFunctions } from '../../core/resolve/escapes';
import { functionValue, type FunctionNode } from '../../core/resolve/functions';
import type { Names } from '../../core/emit/names';
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
    return writers.has(fn) && !composed.has(fn) && !fn.generator && !isElementHandler(module, fn);
  });
}

/**
 * Add the boundaries to `replacements`. Each replacement holds the authored nodes it
 * surrounds, so `copy` still applies the other features' replacements inside it.
 *
 * Where the callback ends:
 * - at a `return`, or falling off the end;
 * - for a `return` inside a `try` or `catch` that has a `finally`: after that `finally`, which may
 *   still write (`try { count = 1; return; } finally { count = 2; }`). The `return` records that
 *   it is returning and the outermost such `finally` leaves at its end. A `return` in a `finally`
 *   replaces the first one and leaves itself;
 * - for an async function: at its first `await`, where its synchronous stretch ends, or at its
 *   return if it has none (`async () => { count = 1; }`). After an `await` it runs from a microtask,
 *   and the recovery microtask commits that stretch.
 *
 * A function with any of the last two leaves through one flag (`_open`), so it leaves exactly once
 * whichever way it ends: a `finally` that returns again, or a `break` in a `finally` that cancels
 * a return.
 */
export function emitCallbackBoundaries(
  fns: readonly FunctionNode[], names: Names, runtime: string, replacements: Map<Node, Node>,
): void {
  for (const fn of fns) {
    const body = fn.body;
    if (body === null) continue;
    if (!is.BlockStatement(body) && !fn.async) {
      // `() => count++`: the body may itself be a planned write, so replace the function.
      replacements.set(fn, { ...fn, body: expression('$$runtime.leaveCallback(($$runtime.enterCallback(), $$body))', { runtime, body }) } as Node);
      continue;
    }

    const own = is.BlockStatement(body) ? ownSyntax(body) : ownSyntax(body as Node);
    const protectedReturns = own.returns.filter((node) => protectingTry(own, node) !== null);
    const guarded = fn.async || protectedReturns.length > 0;
    const open = guarded ? names.fresh('_open') : null;
    const returning = protectedReturns.length > 0 ? names.fresh('_returning') : null;

    // `leaveCallback(value)`, or once only: `leaveCallback(value, _open && !(_open = false))`.
    const leave = (value: Node | null): Expression => {
      const argument = value ?? expression('void 0');
      return open === null
        ? expression('$$runtime.leaveCallback($$argument)', { runtime, argument })
        : expression('$$runtime.leaveCallback($$argument, $$open && !($$open = false))', { runtime, argument, open });
    };

    for (const node of own.returns) {
      replacements.set(node, b.ReturnStatement({
        argument: protectedReturns.includes(node)
          ? expression('($$returning = true, $$argument)', { returning: returning!, argument: node.argument ?? expression('void 0') })
          : leave(node.argument),
      }) as Node);
    }
    if (returning !== null) {
      for (const tried of own.tries) {
        if (tried.finalizer === null || protectingTry(own, tried) !== null) continue;
        replacements.set(tried.finalizer, b.BlockStatement({ body: [
          ...tried.finalizer.body,
          statement('if ($$returning) $$leave;', { returning, leave: leave(null) }),
        ] as Statement[] }) as Node);
      }
    }
    if (fn.async) {
      for (const node of own.awaits) {
        if (is.AwaitExpression(node)) {
          replacements.set(node, b.AwaitExpression({ argument: leave(node.argument) as Expression }) as Node);
        } else {
          // `for await (… of items)`: the loop's first wait follows evaluating `items`.
          replacements.set(node.right, leave(node.right));
        }
      }
    }

    const start: Statement[] = [
      statement('$$runtime.enterCallback();', { runtime }),
      ...(open === null ? [] : [statement('let $$open = true;', { open })]),
      ...(returning === null ? [] : [statement('let $$returning = false;', { returning })]),
    ];
    if (!is.BlockStatement(body)) {
      // `async () => value`: the same as `{ return value; }`.
      replacements.set(fn, { ...fn, expression: false, body: b.BlockStatement({ body: [
        ...start, b.ReturnStatement({ argument: leave(body) as Expression }),
      ] as Statement[] }) } as Node);
      continue;
    }
    // Build on what the body already became: source readiness declares its per-call records at
    // the top of the body (`sourceReadinessStorage`), and they must stay. Copies keep their
    // authored origin (`core/emit/copy.ts`), so the returns replaced above are still reached.
    const current = replacements.get(body);
    const statements = (current !== undefined && is.BlockStatement(current) ? current.body : body.body) as Statement[];
    const directives = statements.filter((entry) => is.ExpressionStatement(entry) && typeof entry.directive === 'string');
    replacements.set(body, b.BlockStatement({ body: [
      ...directives,
      ...start,
      ...statements.slice(directives.length),
      // Falling off the end is a return too. After a `return` this line never runs.
      b.ExpressionStatement({ expression: leave(null) as Expression }) as Statement,
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

type ReturnNode = Extract<Node, { type: 'ReturnStatement' }>;
type TryNode = Extract<Node, { type: 'TryStatement' }>;
type AwaitNode = Extract<Node, { type: 'AwaitExpression' }> | Extract<Node, { type: 'ForOfStatement' }>;

/** The returns, `try` statements and waits of this function, not of a function nested in it. */
interface OwnSyntax {
  readonly returns: ReturnNode[];
  readonly tries: TryNode[];
  readonly awaits: AwaitNode[];
}

function ownSyntax(body: Node): OwnSyntax {
  const own: OwnSyntax = { returns: [], tries: [], awaits: [] };
  walk(body, {
    enter(node, context) {
      if (is.Function(node)) context.skip();
      else if (is.ReturnStatement(node)) own.returns.push(node);
      else if (is.TryStatement(node)) own.tries.push(node);
      else if (is.AwaitExpression(node) || (is.ForOfStatement(node) && node.await)) own.awaits.push(node);
    },
  });
  return own;
}

/**
 * The `try` whose `finally` runs after `node` completes: the nearest one holding `node` in its
 * block or its `catch`, not in its `finally`. Null when no `finally` follows it in this function.
 */
function protectingTry(own: OwnSyntax, node: Node): TryNode | null {
  const inside = (outer: Node | null) => outer !== null && outer.start <= node.start && node.end <= outer.end;
  let nearest: TryNode | null = null;
  for (const candidate of own.tries) {
    if (candidate === node || candidate.finalizer === null) continue;
    if (!inside(candidate.block) && !inside(candidate.handler)) continue;
    if (nearest === null || nearest.start < candidate.start) nearest = candidate;
  }
  return nearest;
}
