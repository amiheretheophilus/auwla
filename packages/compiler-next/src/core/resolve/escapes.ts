/**
 * Escaping functions (`wiki/compiler/output.md`, "Phase 3 design", rule 5).
 *
 * A function escapes when its value leaves the code that creates it: it is
 * stored, passed, returned, exported, aliased, or is a method or accessor. Unknown
 * code may then call it at any time, including in the middle of a computation, so
 * the compiler cannot list its reads at the call site. A function that is only
 * ever called directly (`multiply(price)`, an IIFE) does not escape: its reads are
 * expanded where it is called (`../graph/inputs.ts`).
 *
 * Over-approximation is safe: an escaping function only reports what it reads.
 */
import { is } from 'yuku-ast';
import type { Binding, Module } from 'yuku-analyzer';
import type { Node } from 'yuku-parser';
import type { FunctionNode } from './functions';

export function findEscapingFunctions(module: Module): FunctionNode[] {
  const functions = module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
  return functions.filter((fn) => escapes(module, fn));
}

function escapes(module: Module, fn: FunctionNode): boolean {
  const parent = outerParent(module, fn);

  // `(() => { … })()`: called where it is created.
  if (is.CallExpression(parent) && unwrapped(parent.callee) === fn) return false;

  // `function f() {}` and `const f = () => {}` escape through their name.
  const name = functionName(fn, parent);
  if (name === null) return true;
  const binding = module.bindingOf(name);
  if (binding === null) return true;
  return isExported(module, name) || !onlyCalledDirectly(module, binding);
}

/** The identifier that names `fn`, when the name is its only way out. */
function functionName(fn: FunctionNode, parent: Node | null): Node | null {
  if (is.FunctionDeclaration(fn) && fn.id !== null) return fn.id;
  if (is.VariableDeclarator(parent) && parent.init !== null && unwrapped(parent.init) === fn && is.Identifier(parent.id)) {
    return parent.id;
  }
  return null;
}

/** `export function f`, `export const f = …`, `export default function f`. */
function isExported(module: Module, name: Node): boolean {
  for (const ancestor of module.ancestors(name)) {
    if (is.ExportNamedDeclaration(ancestor) || is.ExportDefaultDeclaration(ancestor)) return true;
    if (is.Program(ancestor) || is.BlockStatement(ancestor)) return false;
  }
  return false;
}

/** Every use of the name is `f(…)`: not `g = f`, `[f]`, `f.call(…)`, `new f()`, `export { f }`. */
function onlyCalledDirectly(module: Module, binding: Binding): boolean {
  return binding.references.every((reference) => {
    if (reference.inTypePosition) return true;
    if (reference.isWrite) return false;
    const parent = outerParent(module, reference.node);
    return is.CallExpression(parent) && unwrapped(parent.callee) === reference.node;
  });
}

function isTransparent(node: Node): boolean {
  return is.ParenthesizedExpression(node)
    || is.TSNonNullExpression(node)
    || is.TSAsExpression(node)
    || is.TSSatisfiesExpression(node);
}

function outerParent(module: Module, node: Node): Node | null {
  let parent = module.parentOf(node);
  while (parent !== null && isTransparent(parent)) parent = module.parentOf(parent);
  return parent;
}

function unwrapped(node: Node): Node {
  let current = node;
  while (isTransparent(current) && 'expression' in current) {
    current = (current as { expression: Node }).expression;
  }
  return current;
}
