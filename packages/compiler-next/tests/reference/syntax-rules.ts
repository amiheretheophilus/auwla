/**
 * Rules the reference decides from syntax, written here apart from compiler-next. If the reference
 * used compiler-next's own answers, a wrong answer would be in both and every comparison would
 * agree (`wiki/compiler/testing.md`, "What agreement cannot catch").
 */
import type { Module } from 'yuku-analyzer';
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';

/**
 * Methods of arrays, strings, maps, sets and numbers that never change their receiver
 * (`wiki/decisions.md`, 2026-11-04: a method name means the built-in method).
 */
const READING_METHODS = new Set([
  // Arrays: copies and reads.
  'slice', 'concat', 'toReversed', 'toSorted', 'toSpliced', 'with', 'flat', 'flatMap', 'map', 'filter',
  'indexOf', 'lastIndexOf', 'includes', 'at', 'join', 'find', 'findIndex', 'findLast', 'findLastIndex',
  'some', 'every', 'reduce', 'reduceRight', 'forEach', 'keys', 'values', 'entries',
  // Strings.
  'charAt', 'charCodeAt', 'codePointAt', 'endsWith', 'startsWith', 'localeCompare', 'match', 'matchAll',
  'normalize', 'padEnd', 'padStart', 'repeat', 'replace', 'replaceAll', 'search', 'split', 'substring',
  'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase', 'trim', 'trimEnd', 'trimStart',
  // Maps and sets.
  'get', 'has',
  // Any value.
  'toString', 'toFixed', 'toPrecision', 'valueOf', 'toLocaleString',
]);

/** Host functions and namespaces that compute only from what they are given. */
const PURE_GLOBALS = new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite']);
const PURE_NAMESPACES = new Set(['Math', 'JSON']);
const PURE_OBJECT_MEMBERS = new Set(['keys', 'values', 'entries', 'is', 'hasOwn', 'fromEntries', 'isArray', 'from', 'of']);

/** Method names the module gives another meaning, in a class or an object literal. */
function ownMethodNames(module: Module): Set<string> {
  const names = new Set<string>();
  const add = (key: Node, computed: boolean) => {
    if (!computed && is.Identifier(key)) names.add(key.name);
    if (is.Literal(key) && typeof key.value === 'string') names.add(key.value);
  };
  module.walk({
    MethodDefinition: (node) => add(node.key, node.computed),
    Property: (node) => {
      if (is.Function(node.value) || node.method) add(node.key, node.computed);
    },
  });
  return names;
}

/** A host call that computes only from its arguments: `String(x)`, `Math.max(a, b)`, `Object.keys(o)`. */
function pureHostCall(module: Module, callee: Node): boolean {
  const global = (node: Node) => is.Identifier(node) && module.referenceOf(node)?.binding == null;
  if (global(callee)) return PURE_GLOBALS.has((callee as { name: string }).name);
  if (!is.MemberExpression(callee) || callee.computed || !is.Identifier(callee.property) || !global(callee.object)) return false;
  const owner = (callee.object as { name: string }).name;
  return PURE_NAMESPACES.has(owner) || ((owner === 'Object' || owner === 'Array') && PURE_OBJECT_MEMBERS.has(callee.property.name));
}

/**
 * A callback given to a reading method changes nothing outside itself: it writes only names it
 * declares, and calls only reading methods and pure host functions.
 */
function callbackOnlyReads(module: Module, callback: Node, own: ReadonlySet<string>): boolean {
  let reads = true;
  const declaredInside = (target: Node): boolean => {
    if (!is.Identifier(target)) return false;
    const declaration = module.referenceOf(target)?.binding?.declarations[0];
    return declaration !== undefined && declaration.start >= callback.start && declaration.end <= callback.end;
  };
  walk(callback, {
    enter(node, ctx) {
      if (is.AssignmentExpression(node)) reads &&= declaredInside(node.left);
      else if (is.UpdateExpression(node)) reads &&= declaredInside(node.argument);
      else if (is.UnaryExpression(node) && node.operator === 'delete') reads = false;
      else if (is.NewExpression(node) || is.AwaitExpression(node) || is.YieldExpression(node)) reads = false;
      else if (is.CallExpression(node)) reads &&= pureHostCall(module, node.callee) || methodOnlyReads(module, node, own);
      if (!reads) ctx.stop();
    },
  });
  return reads;
}

function methodOnlyReads(module: Module, call: Extract<Node, { type: 'CallExpression' }>, own: ReadonlySet<string>): boolean {
  const callee = call.callee;
  if (!is.MemberExpression(callee) || callee.computed || !is.Identifier(callee.property)) return false;
  const name = callee.property.name;
  if (!READING_METHODS.has(name) || own.has(name)) return false;
  return call.arguments.every((argument) => !is.Function(argument) || callbackOnlyReads(module, argument, own));
}

/**
 * `items.includes(x)`, `items.reduce((a, b) => a + b, 0)`: a method that only reads, with
 * inline callbacks that change nothing, never builds the value it reads (`wiki/decisions.md`,
 * 2026-11-05). So does a pure host call such as `Math.max(…)`.
 */
export function callOnlyReads(module: Module, call: Node): boolean {
  if (!is.CallExpression(call) || !is.MemberExpression(call.callee)) return false;
  return pureHostCall(module, call.callee) || methodOnlyReads(module, call, ownMethodNames(module));
}

export interface LiteralField {
  readonly key: string;
  readonly value: Node;
}

/**
 * The fields of an object literal made only of plain named fields, or null
 * (`wiki/decisions.md`, 2026-11-05). A spread, a computed key, an accessor, a method, `__proto__`
 * or a repeated key decides at run time what the object holds, so it is built again whole.
 */
export function literalFields(init: Node | null | undefined): readonly LiteralField[] | null {
  if (init === null || init === undefined || !is.ObjectExpression(init)) return null;
  const fields: LiteralField[] = [];
  for (const property of init.properties) {
    if (!is.Property(property) || property.computed || property.kind !== 'init') return null;
    const key = is.Identifier(property.key) ? property.key.name
      : is.Literal(property.key) && typeof property.key.value === 'string' ? property.key.value : null;
    if (key === null || key === '__proto__' || fields.some((field) => field.key === key)) return null;
    fields.push({ key, value: property.value });
  }
  return fields;
}
