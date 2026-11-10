/**
 * Which host globals the program itself changes.
 *
 * A global the program never writes is not an input (`../../wiki/decisions.md`,
 * 2026-10-21): `Math.round(x)`, `setInterval`, `document.title` and `console`
 * are read as they are, and never make a value reactive. A global the program
 * does write (`count = 1` without a declaration, `window.count = 1`,
 * `document.title = 'x'`) is an input like any other changing value.
 *
 * Method calls on a global (`localStorage.setItem(…)`, `console.log(…)`) are
 * not counted as writes: they are host APIs, and counting them would make
 * `Math.random()` turn `Math` into an input.
 */
import { is } from 'yuku-ast';
import type { Module, Reference } from 'yuku-analyzer';
import type { Node } from 'yuku-parser';

/** Names for the global object itself: `window.count = 1` writes the global `count`. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self']);

export interface GlobalWrites {
  /** A computed write through the global object (`window[key] = 1`) may change any global. */
  readonly any: boolean;
  readonly names: ReadonlySet<string>;
  /**
   * The program runs code from text (`eval` used at all, `Function` called), which may write any
   * global out of sight. That does not make every global an input, which would rebuild each value
   * computed from one (`new Proxy(…)`): only what a site shows is tracked (`isTrackedGlobal`).
   */
  readonly fromText: boolean;
}

export function isWrittenGlobal(globals: GlobalWrites, name: string): boolean {
  return globals.any || globals.names.has(name);
}

/** A global a site re-reads when it may have changed: written, or anything after code from text. */
export function isTrackedGlobal(globals: GlobalWrites, name: string): boolean {
  return globals.fromText || isWrittenGlobal(globals, name);
}

export function findGlobalWrites(modules: readonly Module[]): GlobalWrites {
  const names = new Set<string>();
  let any = false;
  let fromText = false;

  for (const module of modules) {
    for (const reference of module.unresolvedReferences) {
      if (reference.inTypePosition) continue;

      if (reference.isWrite) {
        names.add(reference.name);
        continue;
      }

      if (runsCodeFromText(module, reference)) {
        fromText = true;
        continue;
      }

      const firstKey = writtenProperty(module, reference);
      if (firstKey === undefined) continue;

      names.add(reference.name);
      if (!GLOBAL_OBJECTS.has(reference.name)) continue;
      if (firstKey === null) {
        any = true;
      } else {
        names.add(firstKey);
      }
    }
  }
  return { any, names, fromText };
}

/**
 * One place a module touches a global the program writes: `node` is read (`trackGlobal`) or is
 * the whole write (`publishGlobal`). `name` is the global, or null for a write whose name is
 * computed (`window[key] = 1`), which may change any of them.
 */
export interface GlobalAccess {
  readonly node: Node;
  readonly name: string | null;
  readonly write: boolean;
  /** A name being called: tracked beside it, `(trackGlobal(name), f)(…)`, so the call is unchanged. */
  readonly callee?: boolean;
}

/**
 * How `module` touches written globals, so emit can track each read and announce each write,
 * and whether it runs code from text, after which any global may have changed.
 */
export function planGlobalAccesses(module: Module, globals: GlobalWrites): { accesses: GlobalAccess[]; codeFromText: boolean } {
  const accesses: GlobalAccess[] = [];
  let codeFromText = false;
  for (const reference of module.unresolvedReferences) {
    if (reference.inTypePosition) continue;
    if (runsCodeFromText(module, reference)) codeFromText = true;
    if (!isTrackedGlobal(globals, reference.name)) continue;
    const access = accessOf(module, reference);
    if (access === null) continue;
    // A global only code from text might change is tracked where a site shows it, in JSX, and
    // not where setup or a derived value reads it: a tracked `new Proxy(…)` there would rebuild
    // its value after every handler. A call of one stays as written.
    if (!isWrittenGlobal(globals, reference.name)) {
      if (access.callee === true) continue;
      if (![...module.ancestors(reference.node)].some((ancestor) => is.JSXExpressionContainer(ancestor))) continue;
    }
    accesses.push(access);
  }
  return { accesses, codeFromText };
}

function accessOf(module: Module, reference: Reference): GlobalAccess | null {
  let node: Node = reference.node;
  let name: string | null = reference.name;
  const parent = module.parentOf(node);
  // `window.count` is the global `count`; `window[key]` is any of them.
  if (GLOBAL_OBJECTS.has(reference.name) && is.MemberExpression(parent) && parent.object === node) {
    node = parent;
    name = !parent.computed && is.Identifier(parent.property) ? parent.property.name : null;
  }
  if (reference.isWrite) {
    const write = module.parentOf(node);
    return is.AssignmentExpression(write) || is.UpdateExpression(write) ? { node: write, name, write: true } : null;
  }
  // A write through a member (`count.x = 1`, `document.title = 'x'`, `window.count = 1`) changes
  // the global's value.
  let chain = node;
  let above = module.parentOf(chain);
  while (is.MemberExpression(above) && above.object === chain) {
    chain = above;
    above = module.parentOf(chain);
  }
  if (chain !== node || is.MemberExpression(node)) {
    const assigned = is.AssignmentExpression(above) && above.left === chain;
    const updated = is.UpdateExpression(above) && above.argument === chain;
    const deleted = is.UnaryExpression(above) && above.operator === 'delete' && above.argument === chain;
    if (assigned || updated || deleted) return { node: above!, name, write: true };
  }
  const user = module.parentOf(node);
  // `typeof missing` must not throw, so the whole `typeof` is what is tracked.
  if (is.UnaryExpression(user) && user.operator === 'typeof') return { node: user, name, write: false };
  // A called member (`window.f()`) keeps its receiver, so it is not wrapped. A called name has no
  // receiver, so it is tracked beside the call (`callee`), except a direct `eval`, which must stay
  // direct to see its scope.
  const called = ((is.CallExpression(user) || is.NewExpression(user)) && user.callee === node)
    || (is.TaggedTemplateExpression(user) && user.tag === node);
  if (called) {
    return is.Identifier(node) && name !== 'eval' ? { node, name, write: false, callee: true } : null;
  }
  // `window[key]` read: it depends on every written global (`name` null).
  return { node, name, write: false };
}

function runsCodeFromText(module: Module, reference: Reference): boolean {
  if (reference.name === 'eval') return true;
  if (reference.name !== 'Function') return false;
  const parent = module.parentOf(reference.node);
  return (is.CallExpression(parent) || is.NewExpression(parent)) && parent.callee === reference.node;
}

/**
 * When `reference` is the root of a member that is assigned, updated or deleted
 * (`window.count = 1`, `document.title += '!'`), the first property name, or
 * null when it is computed. Undefined when nothing is written through it.
 */
function writtenProperty(module: Module, reference: Reference): string | null | undefined {
  let chain: Node = reference.node;
  let parent = module.parentOf(chain);
  let firstKey: string | null | undefined;

  while (is.MemberExpression(parent) && parent.object === chain) {
    if (firstKey === undefined) {
      firstKey = !parent.computed && is.Identifier(parent.property) ? parent.property.name : null;
    }
    chain = parent;
    parent = module.parentOf(chain);
  }
  if (firstKey === undefined) return undefined;

  const assigned = is.AssignmentExpression(parent) && parent.left === chain;
  const updated = is.UpdateExpression(parent) && parent.argument === chain;
  const deleted = is.UnaryExpression(parent) && parent.operator === 'delete' && parent.argument === chain;
  return assigned || updated || deleted ? firstKey : undefined;
}
