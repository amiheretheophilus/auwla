/** Component calls share value slots with stored JSX and list rows. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { intrinsicTag } from '../../core/plan/jsx';

export type ComponentCall = Extract<Node, { type: 'JSXElement' }>;

/** Spread-bearing hosts need the same ordered props application as dynamic tags. */
export function isComponentCall(node: Node): node is ComponentCall {
  if (!is.JSXElement(node)) {
    return false;
  }
  if (intrinsicTag(node) === null) {
    return true;
  }
  return node.openingElement.attributes.some(is.JSXSpreadAttribute);
}
