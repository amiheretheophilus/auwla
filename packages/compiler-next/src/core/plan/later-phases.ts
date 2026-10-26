/**
 * Framework APIs that a later phase compiles (`wiki/compiler/plan.md`).
 *
 * Compiled as ordinary calls they would run, but with the wrong semantics:
 * an effect would not re-run and a source would not wait. A clear error is
 * better than output that looks right in simple cases.
 */
import type { ResolvedModule } from '../resolve';
import { unsupported, type TemplateContext } from './template';

/** The package that holds sources, `Group`, and the server-function client helpers. */
const DATA_PACKAGE = '@memoized-dom/data';

export function rejectLaterPhases(entry: ResolvedModule, context: TemplateContext): void {
  const module = entry.module;

  for (const declaration of module.imports) {
    if (declaration.typeOnly) continue;
    const fromData = declaration.specifier === DATA_PACKAGE || declaration.specifier.startsWith(`${DATA_PACKAGE}/`);
    if (fromData) unsupported(context, declaration.node, `imports from \`${declaration.specifier}\``, 8);
  }
}
