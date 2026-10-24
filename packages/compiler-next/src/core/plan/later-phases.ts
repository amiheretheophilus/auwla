/**
 * Framework APIs that a later phase compiles (`wiki/compiler/plan.md`).
 *
 * Compiled as ordinary calls they would run, but with the wrong semantics:
 * an effect would not re-run and a source would not wait. A clear error is
 * better than output that looks right in simple cases.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { ResolvedModule } from '../resolve';
import { unsupported, type TemplateContext } from './template';

/** The package that holds sources, `Group`, and the server-function client helpers. */
const DATA_PACKAGE = '@memoized-dom/data';

/** Ambient lifecycle calls, recognized only when no local binding shadows them. */
const LIFECYCLE = new Set(['$effect', '$cleanup']);

export function rejectLaterPhases(entry: ResolvedModule, context: TemplateContext, components: ReadonlySet<Node>): void {
  const module = entry.module;

  // A compiled component mounts DOM; called for its value (`items.map(Row)`,
  // `const view = Row(x)`) it must return markup as the reference's does.
  for (const fn of components) {
    const name = componentName(module, fn);
    for (const reference of name === null ? [] : module.bindingOf(name)?.references ?? []) {
      if (!usedForValue(module, reference.node)) continue;
      unsupported(context, reference.node, 'a component used as a value or called for its result', 6);
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

function componentName(module: ResolvedModule['module'], fn: Node): Node | null {
  if (is.Function(fn) && fn.id !== null) return fn.id;
  const parent = module.parentOf(fn);
  return is.VariableDeclarator(parent) ? parent.id : null;
}

/**
 * Whether a use of a component's name needs its value: anything but a tag, an
 * export, or a call whose result is discarded (which only runs its setup).
 */
function usedForValue(module: ResolvedModule['module'], node: Node): boolean {
  const parent = module.parentOf(node);
  if (is.JSXOpeningElement(parent) || is.JSXClosingElement(parent) || is.JSXMemberExpression(parent)) return false;
  if (is.ExportSpecifier(parent) || is.ExportDefaultDeclaration(parent)) return false;
  if (is.CallExpression(parent) && parent.callee === node) {
    return !is.ExpressionStatement(module.parentOf(parent));
  }
  return true;
}
