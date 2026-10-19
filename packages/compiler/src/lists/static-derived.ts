/**
 * static-derived.ts - derived values over static list literals.
 *
 * A binding whose initializer is a method chain rooted at a primitive array
 * literal (`[1, 2].filter(fn)`) and that is never written always holds the
 * same rows, so a list over it reconciles the chain directly with no reactive
 * routing. The chain returns a new array the program owns: when the binding
 * is written, it is ordinary state (see `captureListSiteInputs`).
 */
import {
  childNode,
  type BaseNode,
} from '../ast';
import {
  isStaticListExpression,
  transparentListExpression,
} from './source-shapes';

/**
 * True when the initializer is a DERIVED chain: at least one method transform
 * applied to a primitive array literal root (`[...].filter(fn)`). A plain
 * array literal (`[...]`) is NOT derived - it is ordinary reactive state.
 */
export function isStaticDerivedChain(expression: BaseNode): boolean {
  const current = transparentListExpression(expression);
  if (current.type !== 'CallExpression') return false;
  const callee = childNode(current, 'callee');
  if (callee?.type !== 'MemberExpression') return false;
  const source = childNode(callee, 'object');
  return source !== null && isStaticListExpression(source);
}
