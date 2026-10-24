/** Binding patterns as emitted code needs them: their names, and as assignments. */
import { b, is, walk } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import { expression } from './quote';

/** The names a binding pattern declares. A replaced target declares none. */
export function patternNames(pattern: Node | null): string[] {
  if (pattern === null) return [];
  if (is.Identifier(pattern)) return [pattern.name];
  if (is.ObjectPattern(pattern)) {
    return pattern.properties.flatMap((property) => patternNames(is.RestElement(property) ? property.argument : property.value));
  }
  if (is.ArrayPattern(pattern)) return pattern.elements.flatMap((element) => patternNames(element));
  if (is.AssignmentPattern(pattern)) return patternNames(pattern.left);
  if (is.RestElement(pattern)) return patternNames(pattern.argument);
  return [];
}

/**
 * Rewrites the `var` declarations inside an emitted statement (not inside its
 * nested functions) as assignments, and returns the names they declared. Code
 * that moves a statement into a new function declares those names outside it,
 * where JavaScript scopes them. Mutates `root`, which must be emitted output.
 */
export function liftVarDeclarations(root: Node): string[] {
  const declared: string[] = [];
  const lift = (declaration: VarDeclaration, position: 'statement' | 'init' | 'left'): Node => {
    for (const declarator of declaration.declarations) declared.push(...patternNames(declarator.id));
    if (position === 'left') return declaration.declarations[0]!.id;
    const assignments = declarationAssignments(declaration);
    if (position === 'init') return assignments ?? expression('void 0');
    return assignments === null ? b.EmptyStatement({}) : b.ExpressionStatement({ expression: assignments });
  };
  walk(root, {
    enter(node, context) {
      if (is.Function(node)) {
        context.skip();
        return;
      }
      if (is.ForStatement(node) && isVar(node.init)) node.init = lift(node.init, 'init') as never;
      if ((is.ForInStatement(node) || is.ForOfStatement(node)) && isVar(node.left)) node.left = lift(node.left, 'left') as never;
      const lists = is.BlockStatement(node) ? [node.body] : is.SwitchCase(node) ? [node.consequent] : [];
      for (const list of lists as Node[][]) {
        list.forEach((entry, index) => {
          if (isVar(entry)) list[index] = lift(entry, 'statement');
        });
      }
      if (is.IfStatement(node)) {
        if (isVar(node.consequent)) node.consequent = lift(node.consequent, 'statement') as never;
        if (isVar(node.alternate)) node.alternate = lift(node.alternate, 'statement') as never;
      }
    },
  });
  return declared;
}

type VarDeclaration = Extract<Node, { type: 'VariableDeclaration' }>;

function isVar(node: Node | null | undefined): node is VarDeclaration {
  return node !== null && node !== undefined && is.VariableDeclaration(node) && node.kind === 'var';
}

/**
 * A declaration's initializers as assignments, in order: `(a = 1, b = 2)`.
 * Null when no declarator has an initializer.
 */
export function declarationAssignments(declaration: Extract<Node, { type: 'VariableDeclaration' }>): Expression | null {
  const assignments = declaration.declarations
    .filter((declarator) => declarator.init !== null)
    .map((declarator) => expression('$$target = $$value', { target: declarator.id, value: declarator.init! }));
  if (assignments.length === 0) return null;
  return assignments.length === 1 ? assignments[0]! : b.SequenceExpression({ expressions: assignments });
}
