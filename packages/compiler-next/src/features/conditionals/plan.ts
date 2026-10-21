/** Native lazy selectors, with independently retained branch templates. */
import { is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import type { ConditionalBranch, ConditionalSelection, Site, Template } from '../../core/plan/model';
import { unwrap } from '../../core/plan/jsx';

export function planConditional(expression: Expression, context: {
  hasMarkup(node: Node): boolean;
  template(node: Extract<Node, { type: 'JSXElement' | 'JSXFragment' }>): { template: Template; sites: Site[] };
  unsupported(node: Node): never;
}) {
  const branches: ConditionalBranch[] = [];
  const selectorInputs: Expression[] = [];
  const primitive = () => {
    const index = branches.length;
    branches.push({ template: null, sites: [] });
    return index;
  };
  const select = (original: Expression): ConditionalSelection => {
    const node = unwrap(original);
    if (is.JSXElement(node) || is.JSXFragment(node)) {
      const index = branches.length;
      branches.push(context.template(node));
      return { kind: 'branch', index, value: null };
    }
    if (is.ConditionalExpression(node)) {
      selectorInputs.push(node.test);
      return { kind: 'test', test: node.test, consequent: select(node.consequent), alternate: select(node.alternate) };
    }
    if (is.LogicalExpression(node) && !context.hasMarkup(node.left)) {
      selectorInputs.push(node.left);
      return { kind: 'logical', operator: node.operator, left: node.left, right: select(node.right), fallback: primitive() };
    }
    if (context.hasMarkup(node)) return context.unsupported(node);
    selectorInputs.push(original);
    return { kind: 'branch', index: primitive(), value: original };
  };
  const selection = select(expression);
  return { selection, branches, selectorInputs };
}
