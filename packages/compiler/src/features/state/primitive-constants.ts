/**
 * Bindings that hold a primitive forever (`wiki/compiler/state-and-derived.md`, "Constant
 * primitives").
 *
 * A module binding keeps a reader (`shared-plan.ts`) because code the compiler cannot see might
 * edit the object it holds. A primitive cannot be edited, only replaced, and only the binding's
 * own module can replace it: an import is read-only. So a binding that is never reassigned, whose
 * initializer is never computed again (kind `Constant`) and always gives a primitive, holds the
 * same value forever. It needs no reader, and markup that reads it is static.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../../core/graph';
import { importedDefinition, isWrittenGlobal, type Module } from '../../core/resolve';

/** Globals that name a primitive. The program could shadow or write them; those are checked. */
const PRIMITIVE_GLOBALS = new Set(['undefined', 'NaN', 'Infinity']);

/** One answer per program: the shared-read plan and each component's sites ask the same graph. */
const byGraph = new WeakMap<SemanticGraph, (node: BindingNode) => boolean>();

export function primitiveConstants(graph: SemanticGraph): (node: BindingNode) => boolean {
  let holdsPrimitive = byGraph.get(graph);
  if (holdsPrimitive === undefined) {
    holdsPrimitive = decidePrimitiveConstants(graph);
    byGraph.set(graph, holdsPrimitive);
  }
  return holdsPrimitive;
}

function decidePrimitiveConstants(graph: SemanticGraph): (node: BindingNode) => boolean {
  const known = new Map<BindingNode, boolean>();

  function holdsPrimitive(node: BindingNode): boolean {
    const settled = known.get(node);
    if (settled !== undefined) return settled;
    // A binding that reaches itself through its initializer is not decided by this rule.
    known.set(node, false);
    const result = isPrimitiveConstant(node);
    known.set(node, result);
    return result;
  }

  function isPrimitiveConstant(node: BindingNode): boolean {
    // An import is the binding it names in a compiled module. A package's is not known.
    const definition = importedDefinition(node.binding);
    if (definition !== null) {
      const named = graph.bindings.get(definition);
      return named !== undefined && holdsPrimitive(named);
    }
    if (node.kind !== 'Constant' || node.initial === null) return false;
    const { initializer, pattern, builders } = node.initial;
    // Destructuring takes a part of another value; a builder edits it after its declaration.
    if (initializer === null || (pattern !== undefined && !is.Identifier(pattern)) || builders.length > 0) return false;
    if (node.writes.some(({ site }) => site.path.length === 0)) return false;
    return givesPrimitive(initializer, node.binding.module);
  }

  /** Whether evaluating `expression` always gives a primitive. */
  function givesPrimitive(expression: Node, module: Module): boolean {
    if (is.Literal(expression)) return !('regex' in expression && expression.regex != null);
    // These operators always give a primitive, whatever they read: the initializer runs once,
    // so what its operands later hold does not matter.
    if (is.TemplateLiteral(expression) || is.UnaryExpression(expression) || is.BinaryExpression(expression)) return true;
    if (is.LogicalExpression(expression)) return givesPrimitive(expression.left, module) && givesPrimitive(expression.right, module);
    if (is.ConditionalExpression(expression)) {
      return givesPrimitive(expression.consequent, module) && givesPrimitive(expression.alternate, module);
    }
    if (is.ParenthesizedExpression(expression)) return givesPrimitive(expression.expression, module);
    if (is.Identifier(expression)) return namesPrimitive(expression, module);
    return false;
  }

  /** `other`, when it is itself a constant primitive, through an import; or `undefined`. */
  function namesPrimitive(identifier: Extract<Node, { type: 'Identifier' }>, module: Module): boolean {
    const binding = module.referenceOf(identifier)?.binding;
    if (binding == null) {
      return PRIMITIVE_GLOBALS.has(identifier.name) && !isWrittenGlobal(graph.resolved.globals, identifier.name);
    }
    const node = graph.bindings.get(binding);
    return node !== undefined && holdsPrimitive(node);
  }

  return holdsPrimitive;
}
