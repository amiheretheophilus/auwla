/**
 * Edits are not reads, for the dependencies the compiler works out before running anything
 * (`wiki/compiler/handlers.md`, "Edits are not reads"). Reading `log` to run `log.push(x)`, or
 * `state` to run `state.count = 1`, finds the object to edit; it reads nothing the object holds.
 * The runtime already reads such a root untracked (`features/handlers/mutations.ts`,
 * `untrackRoot`). The static inputs counted it as a read, so a module value built by a call that
 * only edits state (`const countAtom = atom(0)`, where `atom` runs `values.set(key, 0)`) was built
 * again on every later edit of that state, a new value each time.
 *
 * This is at least as strict as the runtime's known edit (`optimize/methods.ts`, `lowerCall`):
 * every other read in the target stays one (the `i` in `rows[i].done = true`), and so does an
 * assignment that reads the old value (`x.n += 1`, `x.n++`).
 */
import type { Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { methodFact, redefinedNames } from '../../optimize/method-facts';

/** The methods that edit a `Map`, `Set`, `WeakMap` or `WeakSet`, by the constructor that made it. */
const COLLECTION_EDITS: Readonly<Record<string, ReadonlySet<string>>> = {
  Map: new Set(['set', 'delete', 'clear']),
  Set: new Set(['add', 'delete', 'clear']),
  WeakMap: new Set(['set', 'delete']),
  WeakSet: new Set(['add', 'delete']),
};

/** Whether `identifier` is only the root of what an edit changes, so it reads nothing. */
export function isEditRoot(module: Module, identifier: Node): boolean {
  if (!is.Identifier(identifier)) return false;
  // The outermost member of `root.a[b].c`, the path to what is edited.
  let target: Node = identifier;
  let parent = module.parentOf(target);
  while (is.MemberExpression(parent) && parent.object === target) {
    target = parent;
    parent = module.parentOf(target);
  }
  if (target === identifier) return false;

  // `root.a = value`: a plain store reads nothing it replaces.
  if (is.AssignmentExpression(parent) && parent.left === target && parent.operator === '=') return true;
  // `delete root.a`.
  if (is.UnaryExpression(parent) && parent.operator === 'delete' && parent.argument === target) return true;
  // `root.items.push(x)`: a method that edits only its receiver.
  if (is.CallExpression(parent) && parent.callee === target && !parent.optional) {
    return editingCall(module, identifier, target as Extract<Node, { type: 'MemberExpression' }>, parent);
  }
  return false;
}

function editingCall(
  module: Module,
  identifier: Node,
  callee: Extract<Node, { type: 'MemberExpression' }>,
  call: Extract<Node, { type: 'CallExpression' }>,
): boolean {
  if (callee.computed || callee.optional || !is.Identifier(callee.property)) return false;
  const name = callee.property.name;
  if (redefinedNames(module).has(name)) return false;
  // A callback could edit anything (`sort((a, b) => …)`); the runtime judges it, this does not.
  if (call.arguments.some((argument) => is.Function(argument) || is.SpreadElement(argument))) return false;
  if (methodFact(name)?.kind === 'edit') return true;
  // `values.set(key, value)` only where `values` is the collection itself, made here.
  return callee.object === identifier && COLLECTION_EDITS[collectionOf(module, identifier) ?? '']?.has(name) === true;
}

/** `Map` for `const values = new Map()` (the global constructor, never reassigned), else null. */
function collectionOf(module: Module, identifier: Node): string | null {
  const binding = module.referenceOf(identifier)?.binding ?? null;
  if (binding === null || binding.declarations.length !== 1) return null;
  const declarator = module.parentOf(binding.declarations[0]!);
  if (!is.VariableDeclarator(declarator) || declarator.id !== binding.declarations[0] || declarator.init === null) return null;
  const declaration = module.parentOf(declarator);
  if (!is.VariableDeclaration(declaration) || declaration.kind !== 'const') return null;
  const init = declarator.init;
  if (!is.NewExpression(init) || !is.Identifier(init.callee) || !(init.callee.name in COLLECTION_EDITS)) return null;
  // A local `Map` class is not the global one.
  if (module.referenceOf(init.callee)?.binding != null) return null;
  return init.callee.name;
}
