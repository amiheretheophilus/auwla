import type { Node } from 'yuku-parser';
import type { Range } from '../../model';

/** Index syntax and parent links without modifying parser-owned nodes. */
export function indexSyntax(root: Node) {
  const byStart = new Map<number, Node[]>();
  const parents = new Map<Node, Node>();
  const pending: Node[] = [root];

  while (pending.length > 0) {
    const node = pending.pop()!;
    const nodes = byStart.get(node.start) ?? [];
    nodes.push(node);
    byStart.set(node.start, nodes);

    for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (child !== null && typeof child === 'object'
          && 'type' in child && 'start' in child && 'end' in child) {
          parents.set(child as Node, node);
          pending.push(child as Node);
        }
      }
    }
  }

  function at(range: Range): Node | undefined {
    return byStart.get(range[0])?.find((node) => node.end === range[1]);
  }

  function isDirectBodyStatement(expression: Node, ownerRange: Range): boolean {
    const statement = parents.get(expression);
    if (statement?.type !== 'ExpressionStatement') {
      return false;
    }

    const body = parents.get(statement);
    if (body?.type !== 'BlockStatement') {
      return false;
    }

    const owner = parents.get(body);
    return owner?.start === ownerRange[0] && owner.end === ownerRange[1];
  }

  /**
   * TS can report assignability errors on the receiving declaration or JSX
   * name. Include that context so diagnostic routing does not discard them.
   */
  function diagnosticRange(range: Range): Range {
    const node = at(range);
    if (node === undefined) {
      return range;
    }

    const parent = parents.get(node);
    if (parent?.type === 'VariableDeclarator' && parent.init === node) {
      return [parent.start, parent.end];
    }

    let context: Node | undefined = parent;
    if (context?.type === 'JSXExpressionContainer') {
      context = parents.get(context);
    }
    if (context?.type === 'JSXAttribute' || context?.type === 'JSXSpreadAttribute') {
      const opening = parents.get(context);
      if (opening?.type === 'JSXOpeningElement') {
        return [opening.start, opening.end];
      }
    }

    return range;
  }

  return { byStart, at, isDirectBodyStatement, diagnosticRange };
}
