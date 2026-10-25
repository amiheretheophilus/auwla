/** Whether evaluating authored code can do more than read and create values. */
import type { Module } from 'yuku-analyzer';
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';

/**
 * Evaluating `root` (an expression, or running a function's body) makes no
 * explicit call, construction, store outside its own locals, deletion,
 * iteration protocol use or suspension. What remains are property reads and
 * implicit conversions, which compiled code never observes, and creating
 * values: objects, functions (whose bodies do not run) and JSX.
 */
export function effectFree(module: Module, root: Node): boolean {
  if (is.Function(root) && (root.async || root.generator)) return false;
  const local = (target: Node): boolean => {
    if (!is.Identifier(target)) return false;
    const declaration = module.referenceOf(target)?.binding?.declarations[0];
    return declaration !== undefined && declaration.start >= root.start && declaration.end <= root.end;
  };
  let free = true;
  walk(root, {
    enter: (node, ctx) => {
      if (node !== root && is.Function(node)) {
        ctx.skip();
        return;
      }
      const effect = is.CallExpression(node) || is.NewExpression(node) || is.TaggedTemplateExpression(node)
        || is.ImportExpression(node) || is.AwaitExpression(node) || is.YieldExpression(node) || is.Class(node)
        || is.ForOfStatement(node) || is.ForInStatement(node) || is.ArrayPattern(node) || is.JSXSpreadChild(node)
        || (is.SpreadElement(node) && !is.ObjectExpression(ctx.parent))
        || (is.UnaryExpression(node) && node.operator === 'delete')
        || (is.AssignmentExpression(node) && !local(node.left))
        || (is.UpdateExpression(node) && !local(node.argument));
      if (effect) {
        free = false;
        ctx.stop();
      }
    },
  });
  return free;
}
