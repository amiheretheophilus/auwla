/** Whether evaluating authored code can do more than read and create values. */
import type { Module } from 'yuku-analyzer';
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { importedDefinition } from '../core/resolve';
import { methodFact, redefinedNames } from './method-facts';

/** Host functions that only compute from their arguments. */
const PURE_GLOBALS = new Set([
  'String', 'Number', 'Boolean', 'BigInt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
]);
const PURE_NAMESPACES = new Set(['Math', 'JSON', 'Number', 'String', 'Intl']);
const PURE_MEMBERS = new Map([
  ['Object', new Set(['keys', 'values', 'entries', 'is', 'hasOwn', 'fromEntries'])],
  ['Array', new Set(['isArray', 'from', 'of'])],
  ['Date', new Set(['now', 'parse', 'UTC'])],
]);
const PURE_CONSTRUCTORS = new Set(['Date', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Array', 'Object']);

export interface EffectOptions {
  /**
   * Also accept calls of the program's own functions whose bodies are effect-free.
   * Row reuse cannot: it skips the callback, and such a function's reads of
   * component state are not visible in the callback.
   */
  readonly ownFunctions?: boolean;
}

/** Whether `id` names a host global: nothing in the program declares it. */
function isGlobal(module: Module, id: Node): boolean {
  return is.Identifier(id) && module.referenceOf(id)?.binding === null;
}

/** Host functions that run other code but never edit an argument they are given. */
const NON_EDITING_GLOBALS = new Set([
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'structuredClone', 'alert',
]);

/** The compiler's own intrinsics that read a value without editing it. */
const READING_INTRINSICS = new Set(['$track']);

/**
 * `clearInterval(timer)`, `console.log(row)`, `JSON.stringify(rows)`: the callee is a
 * host or framework function, so the value it receives cannot change through this call.
 */
export function callEditsNoArgument(module: Module, call: Extract<Node, { type: 'CallExpression' }>): boolean {
  const callee = call.callee;

  if (is.Identifier(callee)) {
    if (READING_INTRINSICS.has(callee.name) && module.referenceOf(callee)?.binding == null) return true;
    if (!isGlobal(module, callee)) return false;
    return PURE_GLOBALS.has(callee.name) || NON_EDITING_GLOBALS.has(callee.name);
  }

  if (!is.MemberExpression(callee) || callee.computed || !is.Identifier(callee.property)
    || !is.Identifier(callee.object) || !isGlobal(module, callee.object)) return false;

  const owner = callee.object.name;
  return owner === 'console' || PURE_NAMESPACES.has(owner) || PURE_MEMBERS.get(owner)?.has(callee.property.name) === true;
}

/** The method's callback, read before the callback itself is judged. */
function methodCallIsPure(module: Module, call: Extract<Node, { type: 'CallExpression' }>, options: EffectOptions): boolean {
  const callee = call.callee;
  if (!is.MemberExpression(callee) || callee.computed || !is.Identifier(callee.property)) return false;

  const name = callee.property.name;
  if (is.Identifier(callee.object) && isGlobal(module, callee.object)) {
    const owner = callee.object.name;
    if (PURE_NAMESPACES.has(owner) || PURE_MEMBERS.get(owner)?.has(name) === true) return true;
  }

  const fact = methodFact(name);
  if (fact === undefined || fact.kind === 'edit' || redefinedNames(module).has(name)) return false;

  // A callback runs as part of the call, so it counts. Creating one elsewhere does not.
  return call.arguments.every((argument, index) => {
    if (is.Function(argument)) return effectFree(module, argument, options);
    return index !== fact.callback;
  });
}

/**
 * `items.includes(x)`, `items.reduce((a, b) => a + b, 0)`: a method the compiler
 * knows reads, with an inline callback that only computes. Such a call changes
 * nothing, so it never builds the value it reads, and that value does not wait for
 * it (`wiki/decisions.md`, 2026-11-05). The reference renderer follows this too.
 */
export function callOnlyReads(module: Module, call: Node): boolean {
  return is.CallExpression(call) && is.MemberExpression(call.callee) && methodCallIsPure(module, call, {});
}

const ownFunctions = new WeakMap<Node, boolean>();

/** A call of a function declared in the program whose own body is effect-free. */
function ownFunctionIsPure(module: Module, call: Extract<Node, { type: 'CallExpression' }>, options: EffectOptions): boolean {
  if (!is.Identifier(call.callee)) return false;

  const binding = module.referenceOf(call.callee)?.binding ?? null;
  if (binding === null) return false;

  const definition = importedDefinition(binding) ?? binding;
  if (definition.references.some((reference) => reference.isWrite)) return false;

  const name = definition.declarations[0];
  if (name === undefined) return false;

  const parent = definition.module.parentOf(name);
  let fn: Node | null = null;
  if (parent !== null && is.FunctionDeclaration(parent) && parent.id === name) {
    fn = parent;
  } else if (parent !== null && is.VariableDeclarator(parent) && parent.id === name && parent.init !== null && is.Function(parent.init)) {
    fn = parent.init;
  }
  if (fn === null) return false;

  const known = ownFunctions.get(fn);
  if (known !== undefined) return known;

  // A recursive call is judged by the rest of the body.
  ownFunctions.set(fn, true);
  const pure = effectFree(definition.module, fn, options);
  ownFunctions.set(fn, pure);
  return pure;
}

function callIsPure(module: Module, call: Extract<Node, { type: 'CallExpression' }>, options: EffectOptions): boolean {
  if (is.Identifier(call.callee) && isGlobal(module, call.callee) && PURE_GLOBALS.has(call.callee.name)) return true;
  if (methodCallIsPure(module, call, options)) return true;
  return options.ownFunctions === true && ownFunctionIsPure(module, call, options);
}

function constructsPure(module: Module, node: Extract<Node, { type: 'NewExpression' }>): boolean {
  const callee = node.callee;
  if (is.Identifier(callee)) return isGlobal(module, callee) && PURE_CONSTRUCTORS.has(callee.name);
  return is.MemberExpression(callee) && is.Identifier(callee.object) && isGlobal(module, callee.object)
    && callee.object.name === 'Intl';
}

/**
 * Evaluating `root` (an expression, or running a function's body) stores nothing
 * outside its own locals, deletes nothing, and does not suspend. It may call what
 * the compiler knows only reads: the methods in `method-facts.ts`, pure host
 * functions, and, with `ownFunctions`, the program's own effect-free functions.
 */
export function effectFree(module: Module, root: Node, options: EffectOptions = {}): boolean {
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

      const effect = (is.CallExpression(node) && !callIsPure(module, node, options))
        || (is.NewExpression(node) && !constructsPure(module, node))
        || is.TaggedTemplateExpression(node) || is.ImportExpression(node) || is.AwaitExpression(node)
        || is.YieldExpression(node) || is.Class(node)
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
