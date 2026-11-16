/**
 * `$effect` and `$cleanup` are markers, not functions (`wiki/compiler/effects.md`, "Rules"). The
 * compiler replaces a direct call, `$effect(() => …)`, and nothing else: no `$effect` value exists
 * at run time. Used any other way (`const run = $effect`, `fn($effect)`, `typeof $cleanup`), the
 * marker stays in the output and the page fails with "$effect is not defined". That is a compile
 * error instead (`wiki/decisions.md`, 2026-11-16).
 *
 * A module that declares or assigns its own `$effect` has an ordinary function of that name
 * (`lifecycleKind`, `core/resolve/ambient.ts`), which may be used however it likes.
 */
import { is } from 'yuku-ast';
import { CompileError } from '../../core/diagnostics';
import type { Resolved } from '../../core/resolve';

const MARKERS = new Set(['$effect', '$cleanup']);

/** Throws a `CompileError` at the first marker that is not called directly. */
export function checkLifecycleMarkers(resolved: Resolved): void {
  for (const entry of resolved.modules) {
    const module = entry.module;
    const unresolved = module.unresolvedReferences.filter((reference) => {
      return !reference.inTypePosition && MARKERS.has(reference.name);
    });
    // Code that assigns the global itself has a function of that name, not the marker.
    const assigned = new Set(unresolved.filter((reference) => reference.isWrite).map((reference) => reference.name));

    for (const reference of unresolved) {
      if (reference.isWrite || assigned.has(reference.name)) {
        continue;
      }
      const parent = module.parentOf(reference.node);
      if (parent !== null && is.CallExpression(parent) && parent.callee === reference.node) {
        continue;
      }
      throw CompileError.at(
        `\`${reference.name}\` must be called directly, as \`${reference.name}(() => …)\`: the compiler replaces that call, and there is no \`${reference.name}\` value at run time.`,
        entry.path,
        module.source,
        reference.node.start,
      );
    }
  }
}
