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
}

export function isWrittenGlobal(globals: GlobalWrites, name: string): boolean {
  return globals.any || globals.names.has(name);
}

export function findGlobalWrites(modules: readonly Module[]): GlobalWrites {
  const names = new Set<string>();
  let any = false;

  for (const module of modules) {
    for (const reference of module.unresolvedReferences) {
      if (reference.inTypePosition) continue;

      if (reference.isWrite) {
        names.add(reference.name);
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
  return { any, names };
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
