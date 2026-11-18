/**
 * Markup that gives an element its content twice (`wiki/compiler/core.md`, "plan";
 * `wiki/decisions.md`, 2026-11-16).
 *
 * `<div innerHTML="<b>x</b>"><i>y</i></div>` sets the element's content from an HTML string and
 * from JSX children. Only one can show, and nothing says which: the reference shows the children,
 * compiled code the string. The old compiler refused it, and so does this one, before any
 * element is planned, so every way an element is built (template, ordered props, keyed row) is
 * covered at once.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { CompileError } from '../diagnostics';
import type { Resolved } from '../resolve';

/** Throws a `CompileError` at the first child of a host element that also sets `innerHTML`. */
export function checkElementContent(resolved: Resolved): void {
  for (const entry of resolved.modules) {
    const module = entry.module;
    for (const element of module.findAll('JSXElement')) {
      const opening = element.openingElement;
      // A component decides for itself what an `innerHTML` prop means.
      if (!is.JSXIdentifier(opening.name) || !isHostTag(opening.name.name)) {
        continue;
      }
      const setsHtml = opening.attributes.some((attribute) => {
        return is.JSXAttribute(attribute) && is.JSXIdentifier(attribute.name) && attribute.name.name === 'innerHTML';
      });
      const child = setsHtml ? element.children.find(showsContent) : undefined;
      if (child === undefined) {
        continue;
      }
      const tag = opening.name.name;
      throw CompileError.at(
        `<${tag}> sets innerHTML and also has JSX children, and only one can be its content. Use one or the other.`,
        entry.path,
        module.source,
        child.start,
      );
    }
  }
}

/** A lowercase tag or a custom element's name: an element of the document, not a component. */
function isHostTag(name: string): boolean {
  return /^[a-z]/.test(name) || name.includes('-');
}

/** Whether a JSX child puts something in the element: not layout whitespace or an empty `{}` comment. */
function showsContent(child: Node): boolean {
  if (is.JSXText(child)) {
    return child.value.trim() !== '';
  }
  if (is.JSXExpressionContainer(child)) {
    return !is.JSXEmptyExpression(child.expression);
  }
  return true;
}
