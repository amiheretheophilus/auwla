/**
 * Framework APIs that a later phase compiles (`wiki/compiler/plan.md`).
 *
 * Compiled as ordinary calls they would run, but with the wrong semantics:
 * an effect would not re-run and a source would not wait. A clear error is
 * better than output that looks right in simple cases.
 */
import type { ResolvedModule } from '../resolve';
import { is } from 'yuku-ast';
import { unsupported, type TemplateContext } from './template';

/** The package that holds sources, `Group`, and the server-function client helpers. */
const DATA_PACKAGE = '@memoized-dom/data';

/** Ambient lifecycle calls, recognized only when no local binding shadows them. */
const LIFECYCLE = new Set(['$effect', '$cleanup']);

export function rejectLaterPhases(entry: ResolvedModule, context: TemplateContext): void {
  const module = entry.module;

  // Dynamic tags and spread hosts bypass the static-attribute planner. Keep
  // the same explicit lifecycle boundary until reactive refs are implemented.
  for (const attribute of module.findAll('JSXAttribute')) {
    if (is.JSXIdentifier(attribute.name) && attribute.name.name === 'ref') {
      unsupported(context, attribute, 'refs', 7);
    }
  }

  for (const reference of module.unresolvedReferences) {
    if (reference.inTypePosition || !LIFECYCLE.has(reference.name)) continue;
    unsupported(context, reference.node, `\`${reference.name}\``, 7);
  }

  for (const declaration of module.imports) {
    if (declaration.typeOnly) continue;
    const fromData = declaration.specifier === DATA_PACKAGE || declaration.specifier.startsWith(`${DATA_PACKAGE}/`);
    if (fromData) unsupported(context, declaration.node, `imports from \`${declaration.specifier}\``, 8);
  }
}
