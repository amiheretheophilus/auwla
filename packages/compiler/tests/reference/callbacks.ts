/** Static reads stop at function boundaries; actual invocation reads are observed at runtime. */
import type { Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';

export function crossesFunction(module: Module, node: Node, scope: Node): boolean {
  if (node === scope) return false;
  let current = module.parentOf(node);
  while (current !== null && current !== scope) {
    if (is.Function(current) && !isCalledAtOnce(module, current)) return true;
    current = module.parentOf(current);
  }
  return false;
}

/** `(function () { … })()`: created to run here. Its reads are this expression's. */
function isCalledAtOnce(module: Module, fn: Node): boolean {
  let callee = fn;
  let parent = module.parentOf(callee);
  while (is.ParenthesizedExpression(parent)) {
    callee = parent;
    parent = module.parentOf(callee);
  }
  return is.CallExpression(parent) && parent.callee === callee;
}
