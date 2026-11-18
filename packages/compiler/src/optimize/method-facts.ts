/**
 * What a method name means, decided at compile time and never checked at
 * runtime. The user (2026-11-04): if the code says `items.slice(1)` then `slice`
 * is the array method; "that is the user bug" otherwise, not ours to guard.
 *
 * - `copy`: reads its receiver and returns a new value;
 * - `read`: reads its receiver and returns part of it, or a primitive;
 * - `edit`: changes its receiver, and only its receiver.
 *
 * A name that is not listed is unknown and keeps the general observation. A name
 * the module itself gives another meaning (`redefinedNames`) is unknown there too.
 */
import type { Module } from 'yuku-analyzer';
import { is, walk } from 'yuku-ast';

export interface MethodFact {
  readonly kind: 'copy' | 'read' | 'edit';
  /** Position of the callback it calls, or -1. A callback must be inline to be judged. */
  readonly callback: number;
  /** Argument positions it converts to a number; an object there runs authored `valueOf`. */
  readonly converted: readonly number[];
  /** Its result is a number, string or boolean. */
  readonly primitive: boolean;
}

const NONE: readonly number[] = [];

const copy = (callback = -1, converted = NONE): MethodFact => ({ kind: 'copy', callback, converted, primitive: false });
const read = (callback = -1, converted = NONE, primitive = false): MethodFact => ({ kind: 'read', callback, converted, primitive });
const edit = (callback = -1, converted = NONE): MethodFact => ({ kind: 'edit', callback, converted, primitive: false });
const position = (callback = -1) => read(callback, NONE, true);

const FACTS = new Map<string, MethodFact>(Object.entries({
  // Arrays.
  slice: copy(-1, [0, 1]), concat: copy(), toReversed: copy(), toSorted: copy(0), toSpliced: copy(-1, [0, 1]), with: copy(-1, [0]),
  flat: copy(-1, [0]), flatMap: copy(0), map: copy(0), filter: copy(0),
  indexOf: read(-1, [1], true), lastIndexOf: read(-1, [1], true), includes: read(-1, [1], true), at: read(-1, [0]), join: position(),
  find: read(0), findIndex: position(0), findLast: read(0), findLastIndex: position(0),
  some: position(0), every: position(0), reduce: read(0), reduceRight: read(0), forEach: read(0),
  keys: read(), values: read(), entries: read(),
  push: edit(), pop: edit(), shift: edit(), unshift: edit(), reverse: edit(),
  splice: edit(-1, [0, 1]), fill: edit(-1, [1, 2]), sort: edit(0),
  // Map and Set lookups.
  get: read(), has: position(),
  // Strings and numbers. Their receiver cannot change at all.
  trim: read(), trimStart: read(), trimEnd: read(), toUpperCase: read(), toLowerCase: read(),
  startsWith: read(), endsWith: read(), split: read(), substring: read(), charAt: read(), charCodeAt: read(),
  codePointAt: read(), padStart: read(), padEnd: read(), repeat: read(), replace: read(), replaceAll: read(),
  match: read(), matchAll: read(), search: read(), localeCompare: read(), normalize: read(),
  toFixed: read(), toPrecision: read(), toString: read(), toLocaleString: read(), valueOf: read(),
}));

export function methodFact(name: string): MethodFact | undefined {
  return FACTS.get(name);
}

const redefined = new WeakMap<Module, ReadonlySet<string>>();

/**
 * Names this module defines itself: `class Rows { slice() {} }`, `{ map(f) {} }`,
 * `{ map: () => {} }`, `items.slice = …` and `Object.defineProperty(items, 'slice', …)`.
 * A plain data field such as `{ filter: 'all' }` defines no method.
 */
export function redefinedNames(module: Module): ReadonlySet<string> {
  const known = redefined.get(module);
  if (known !== undefined) return known;

  const names = new Set<string>();
  const add = (key: unknown): void => {
    if (is.Identifier(key as never)) names.add((key as { name: string }).name);
    else if (is.Literal(key as never) && typeof (key as { value: unknown }).value === 'string') names.add((key as { value: string }).value);
  };

  walk(module.ast, {
    enter(node) {
      if (is.MethodDefinition(node) && !node.computed) {
        add(node.key);
      } else if (is.Property(node) && !node.computed && (node.method || is.Function(node.value))) {
        add(node.key);
      } else if (is.AssignmentExpression(node) && is.MemberExpression(node.left) && !node.left.computed) {
        add(node.left.property);
      } else if (is.CallExpression(node) && is.MemberExpression(node.callee) && !node.callee.computed
        && is.Identifier(node.callee.property) && node.callee.property.name === 'defineProperty') {
        add(node.arguments[1]);
      }
    },
  });

  redefined.set(module, names);
  return names;
}
