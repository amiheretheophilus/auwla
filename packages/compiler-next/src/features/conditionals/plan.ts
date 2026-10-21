/** Native lazy selectors, with independently retained branch templates. */
import { is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import type { ConditionalBranch, ConditionalSelection, Site, Template } from '../../core/plan/model';
import { unwrap } from '../../core/plan/jsx';

export function canPlanConditional(expression: Expression, hasMarkup: (node: Node) => boolean): boolean {
  const node = unwrap(expression);
  if (is.JSXElement(node) || is.JSXFragment(node)) {
    return true;
  }
  if (is.ConditionalExpression(node)) {
    return canPlanConditional(node.consequent, hasMarkup)
      && canPlanConditional(node.alternate, hasMarkup);
  }
  if (is.LogicalExpression(node)) {
    return !hasMarkup(node.left) && canPlanConditional(node.right, hasMarkup);
  }
  return !hasMarkup(node);
}

export function planConditional(expression: Expression, context: {
  hasMarkup(node: Node): boolean;
  template(node: Extract<Node, { type: 'JSXElement' | 'JSXFragment' }>): { template: Template; sites: Site[] };
  unsupported(node: Node): never;
}) {
  const branches: ConditionalBranch[] = [];
  // A fallthrough return can reach the same authored JSX along several paths.
  // It must retain one branch identity rather than remounting on a path change.
  const markupBranches = new Map<Node, number>();
  const selectorInputs: Expression[] = [];

  function primitiveBranch(): number {
    const index = branches.length;
    branches.push({ template: null, sites: [] });
    return index;
  }

  function select(original: Expression): ConditionalSelection {
    const node = unwrap(original);
    if (is.JSXElement(node) || is.JSXFragment(node)) {
      const existing = markupBranches.get(node);
      if (existing !== undefined) {
        return { kind: 'branch', index: existing, value: null };
      }
      const index = branches.length;
      markupBranches.set(node, index);
      branches.push(context.template(node));
      return { kind: 'branch', index, value: null };
    }
    if (is.ConditionalExpression(node)) {
      selectorInputs.push(node.test);
      return {
        kind: 'test',
        test: node.test,
        consequent: select(node.consequent),
        alternate: select(node.alternate),
      };
    }
    if (is.LogicalExpression(node) && !context.hasMarkup(node.left)) {
      selectorInputs.push(node.left);
      return {
        kind: 'logical',
        operator: node.operator,
        left: node.left,
        right: select(node.right),
        fallback: primitiveBranch(),
      };
    }
    if (context.hasMarkup(node)) {
      return context.unsupported(node);
    }
    selectorInputs.push(original);
    return { kind: 'branch', index: primitiveBranch(), value: original };
  }

  const selection = select(expression);
  return { selection, branches, selectorInputs };
}
