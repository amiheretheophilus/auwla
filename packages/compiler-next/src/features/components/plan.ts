/** Component calls share value slots with stored JSX and list rows. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { intrinsicTag } from '../../core/plan/jsx';

export type ComponentCall = Extract<Node, { type: 'JSXElement' }>;

/** Hosts with spreads or explicit children need ordered props application. */
export function isComponentCall(node: Node): node is ComponentCall {
  if (!is.JSXElement(node)) {
    return false;
  }
  if (intrinsicTag(node) === null) {
    return true;
  }
  return node.openingElement.attributes.some((attribute) => {
    if (is.JSXSpreadAttribute(attribute)) {
      return true;
    }
    // Native JSX evaluates this prop before authored children overwrite it.
    // The component-value path already preserves that ordering and fallback.
    return is.JSXAttribute(attribute)
      && is.JSXIdentifier(attribute.name)
      && (attribute.name.name === 'children' || attribute.name.name === 'suspend');
  });
}
