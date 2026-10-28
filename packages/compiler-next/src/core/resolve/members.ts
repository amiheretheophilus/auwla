/**
 * Whether reading a property may run code the compiler cannot see: a getter or
 * a proxy trap can read state that the expression does not name. Such a read
 * makes its computation opaque (`wiki/compiler/state-and-derived.md`).
 *
 * Two kinds of object are known not to:
 * - a host global the program never writes (`Math.PI`, `document.title`;
 *   `globals.ts`);
 * - constant plain data: a binding that is never written, initialized with an
 *   object or array literal of literals, with no accessors or spreads
 *   (`const sizes = ['s', 'm']`, `const config = { title: 'x' }`). An import of
 *   such a binding counts too.
 *
 * Every other object may have accessors, so its property reads stay opaque.
 */
import { is } from 'yuku-ast';
import type { Binding, Module } from 'yuku-analyzer';
import type { Node } from 'yuku-parser';
import { isWrittenGlobal } from './globals';
import type { Resolved } from '.';
import { importedBinding } from './exports';

export interface PropertyReads {
  /** True when reading `member` may run code that reads other values. */
  mayRunCode(module: Module, member: Node): boolean;
}

export function propertyReads(resolved: Resolved): PropertyReads {
  const plain = new Map<Binding, boolean>();

  function isPlainData(binding: Binding): boolean {
    let known = plain.get(binding);
    if (known === undefined) {
      known = resolved.writesOf(binding).length === 0 && plainInitializer(binding);
      plain.set(binding, known);
    }
    return known;
  }

  return {
    mayRunCode(module, member) {
      const root = memberRoot(member);
      if (!is.Identifier(root)) return true;

      const reference = module.referenceOf(root);
      if (reference === null) return true;
      if (reference.binding === null) {
        return isWrittenGlobal(resolved.globals, reference.name);
      }
      return !isPlainData(definitionOf(reference.binding));
    },
  };
}

/** `a` in `a.b[c].d`, past `(a)`, `a!` and `a as T`. */
function memberRoot(member: Node): Node {
  let current = member;
  while (true) {
    if (is.MemberExpression(current)) {
      current = current.object;
    } else if (is.ParenthesizedExpression(current) || is.TSNonNullExpression(current)
      || is.TSAsExpression(current) || is.TSSatisfiesExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** The binding an import names, or the binding itself. */
function definitionOf(binding: Binding): Binding {
  const definition = importedBinding(binding);
  return definition ?? binding;
}

function plainInitializer(binding: Binding): boolean {
  const name = binding.declarations[0];
  if (name === undefined) return false;
  const declarator = binding.module.parentOf(name);
  if (!is.VariableDeclarator(declarator) || declarator.id !== name || declarator.init === null) {
    return false;
  }
  const init = declarator.init;
  return (is.ObjectExpression(init) || is.ArrayExpression(init)) && isPlainValue(init);
}

/** Literals, and object and array literals made only of them. Functions may be values. */
function isPlainValue(node: Node): boolean {
  if (is.Literal(node)) return true;
  if (is.TemplateLiteral(node)) return node.expressions.length === 0;
  if (is.Function(node)) return true;
  if (is.UnaryExpression(node)) {
    return (node.operator === '-' || node.operator === '+') && is.Literal(node.argument);
  }
  if (is.ArrayExpression(node)) {
    return node.elements.every((element) => element === null || isPlainValue(element));
  }
  if (is.ObjectExpression(node)) {
    return node.properties.every((property) => {
      // A getter or setter runs code on access; a spread copies an unknown object.
      if (!is.Property(property) || property.kind !== 'init' || property.computed) return false;
      return isPlainValue(property.value);
    });
  }
  return false;
}
