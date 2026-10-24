/** Binding patterns as emitted code needs them: their names, and as assignments. */
import { b, is } from 'yuku-ast';
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
