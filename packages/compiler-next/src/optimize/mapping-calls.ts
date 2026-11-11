/**
 * The calls that turn items into rows, which the row cache and the row list can
 * stand in for (`row-reuse.ts`, `row-lists.ts`):
 *
 * - `items.map(row)`: one argument. The runtime still calls a receiver's own
 *   `map` when the receiver is not an array (`runtime/src/list-map.ts`).
 * - `Array.from(items, row)`: two arguments, with `Array` the host global, which
 *   the module never assigns, and no `from` the module defines itself
 *   (`redefinedNames`). JSX+ lowers a direct `for...of` loop in markup to this
 *   form (`packages/jsx-plus`, `wiki2/syntax.md`). The runtime collects the
 *   items as `Array.from` does (`iteratedItems`).
 *
 * Each form takes the callback as `(item, index)`. Whether the callback lets rows
 * be reused is decided separately (`rowReuse`); this only recognizes the shape.
 * An optional call (`items?.map(row)`) is not recognized here: methods.ts rejects
 * a short-circuiting chain for both forms.
 */
import type { Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { redefinedNames } from './method-facts';

type Call = Extract<Node, { type: 'CallExpression' }>;

export type MappingForm = 'map' | 'from';

export interface MappingCall {
  readonly form: MappingForm;
  /** What is iterated: the receiver of `map`, the first argument of `Array.from`. */
  readonly items: Node;
  readonly callback: Node;
}

export function mappingCall(module: Module, call: Call): MappingCall | null {
  const callee = call.callee;
  if (!is.MemberExpression(callee) || callee.computed || is.Super(callee.object) || !is.Identifier(callee.property)) return null;
  if (call.arguments.some((argument) => is.SpreadElement(argument))) return null;

  const name = callee.property.name;
  if (name === 'map' && call.arguments.length === 1) {
    return { form: 'map', items: callee.object, callback: call.arguments[0]! };
  }
  if (name === 'from' && call.arguments.length === 2 && isIntrinsicArray(module, callee.object)
    && !redefinedNames(module).has('from')) {
    return { form: 'from', items: call.arguments[0]!, callback: call.arguments[1]! };
  }
  return null;
}

/** `Array`, naming the host global: nothing declares it and nothing assigns it. */
function isIntrinsicArray(module: Module, node: Node): boolean {
  if (!is.Identifier(node) || node.name !== 'Array' || module.referenceOf(node)?.binding !== null) return false;
  return !module.references.some((reference) => reference.binding === null && reference.isWrite
    && is.Identifier(reference.node) && reference.node.name === 'Array');
}
