/** What code reads, on yuku's binding and reference model. Test-only. */
import type { Binding, Module, Reference } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import { crossesFunction } from './callbacks';

type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;

/** Finds the bindings a piece of code reads. A local function stands for what it reads. */
export class Reads {
  constructor(private readonly module: Module) {}

  /**
   * Static reads inside `roots`, following direct calls to local functions.
   * A nested function's body is excluded: creating it does not read its captures.
   * Runtime tracing adds those reads if a caller actually invokes the callback.
   * Reads inside `skip` (parts of a root) are left out.
   */
  inside(roots: Node[], exclude: Binding | undefined, skip: Node[] = []): Set<Binding> {
    return new Set(this.referencesInside(roots, exclude, skip).keys());
  }

  /** Keep reached uses as well as bindings, including uses in called helpers. */
  referencesInside(roots: Node[], exclude?: Binding, skip: Node[] = []): Map<Binding, Reference[]> {
    const found = new Map<Binding, Reference[]>();
    for (const root of roots) this.collect(root, root, false, found, new Set(), skip);
    if (exclude) found.delete(exclude);
    return found;
  }

  /**
   * Static member paths read from a binding inside `root`: `props.user.name` gives
   * `{ binding: props, path: ['user', 'name'] }`. A loading value can sit inside an
   * object (a prop the parent is still waiting for); the path finds it.
   */
  paths(root: Node, skip: Node[] = []): Array<{ binding: Binding; path: string[] }> {
    const found: Array<{ binding: Binding; path: string[] }> = [];

    const visit = (reference: Reference | null) => {
      const binding = reference?.binding;
      if (!binding || reference.isWrite || reference.inTypePosition) return;
      if (this.isDeclaredInside(binding, root) || isWithin(reference.node, skip)) return;
      if (crossesFunction(this.module, reference.node, root)) return;
      if (this.functionOf(binding) !== undefined) return;

      const path: string[] = [];
      let node: Node = reference.node;
      let parent = this.module.parentOf(node);
      // `box.user` and `box[0]` name their key; `box[i]` does not.
      const keyOf = (member: Extract<Node, { type: 'MemberExpression' }>): string | null => {
        if (!member.computed) return is.Identifier(member.property) ? member.property.name : null;
        const key = member.property;
        return is.Literal(key) && (typeof key.value === 'string' || typeof key.value === 'number') ? String(key.value) : null;
      };
      while (is.MemberExpression(parent) && parent.object === node && keyOf(parent) !== null
        && parent.start >= root.start && parent.end <= root.end) {
        path.push(keyOf(parent)!);
        node = parent;
        parent = this.module.parentOf(node);
      }
      if (path.length > 0) found.push({ binding, path });
    };

    this.module.walk({ Identifier: (_node, ctx) => visit(ctx.reference) }, root);
    return found;
  }

  /**
   * What an effect callback reads while it runs: reads directly in its body, and in
   * local functions it calls. Creating a nested callback does not subscribe the
   * effect to that callback's captures. If it runs immediately, runtime tracing
   * records its inputs. Updates (`runs++`) are writes, not reads.
   */
  ofCallback(callback: Expression): Set<Binding> {
    const found = new Map<Binding, Reference[]>();
    let fn: Node | undefined = callback;
    if (is.Identifier(callback)) {
      const binding = this.module.referenceOf(callback)?.binding;
      fn = binding ? this.functionOf(binding) : undefined;
    }
    if (fn !== undefined && is.Function(fn)) this.collect(fn, fn, true, found, new Set([fn]));
    return new Set(found.keys());
  }

  private collect(
    root: Node,
    scope: Node,
    directOnly: boolean,
    found: Map<Binding, Reference[]>,
    visited: Set<Node>,
    skip: Node[] = [],
  ): void {
    const visit = (reference: Reference | null) => {
      const binding = reference?.binding;
      if (!binding || reference.isWrite || reference.inTypePosition) return;
      if (this.isDeclaredInside(binding, scope)) return;
      if (isWithin(reference.node, skip)) return;
      // Edits are not reads: `pool.push(row)` finds the object to edit and reads nothing in it.
      if (onlyEdits(this.module, reference.node)) return;
      // A nested callback reads its captures when invoked, not when created.
      if (crossesFunction(this.module, reference.node, root)) return;
      if (directOnly && enclosingFunction(this.module, reference.node) !== scope) return;

      const fn = this.functionOf(binding);
      if (fn === undefined) {
        const references = found.get(binding) ?? [];
        references.push(reference!);
        found.set(binding, references);
        return;
      }

      const parent = this.module.parentOf(reference.node);
      if (visited.has(fn) || !is.CallExpression(parent) || parent.callee !== reference.node) return;
      // Creating a generator reads nothing. Only taking values from it runs its body.
      if (fn.generator && !this.isConsumedAtOnce(parent)) return;
      visited.add(fn);
      this.collect(fn, fn, directOnly, found, visited, skip);
    };

    this.module.walk({
      Identifier: (_node, ctx) => visit(ctx.reference),
      JSXIdentifier: (_node, ctx) => visit(ctx.reference),
    }, root);
  }

  /** Bindings read directly in `part`, not through the functions it calls. */
  directReads(part: Node): Binding[] {
    const found = new Set<Binding>();
    const visit = (reference: Reference | null) => {
      if (reference?.binding && !reference.isWrite && !reference.inTypePosition
        && !crossesFunction(this.module, reference.node, part)) {
        found.add(reference.binding);
      }
    };
    this.module.walk({
      Identifier: (_node, ctx) => visit(ctx.reference),
      JSXIdentifier: (_node, ctx) => visit(ctx.reference),
    }, part);
    return [...found];
  }

  /** Whether `binding` is declared, or written, inside `root`. */
  isLocalTo(binding: Binding, root: Node): boolean {
    if (binding.declarations.some((name) => isWithin(name, [root]))) return true;
    return binding.references.some((reference) => reference.isWrite && isWithin(reference.node, [root]));
  }

  /** `const [a] = walk()`, `[...walk()]`, `for (x of walk())` and `walk().next()`. */
  private isConsumedAtOnce(call: Node): boolean {
    const parent = this.module.parentOf(call);
    if (is.VariableDeclarator(parent)) return !is.Identifier(parent.id);
    return is.SpreadElement(parent) || is.MemberExpression(parent) || (is.ForOfStatement(parent) && parent.right === call);
  }

  /** The function a binding names: `function f() {}` or `const f = () => {}`. */
  functionOf(binding: Binding): FunctionNode | undefined {
    // Reassigned, it holds a value like any other, and can be a different function next time.
    if (binding.references.some((reference) => reference.isWrite)) return undefined;
    const name = binding.declarations[0];
    const parent = name && this.module.parentOf(name);
    if (is.FunctionDeclaration(parent) && parent.id === name) {
      return parent;
    }
    if (is.VariableDeclarator(parent) && parent.id === name && is.Function(parent.init)) {
      return parent.init as FunctionNode;
    }
    return undefined;
  }

  private isDeclaredInside(binding: Binding, root: Node): boolean {
    return binding.declarations.some((name) => {
      for (const ancestor of this.module.ancestors(name)) {
        if (ancestor === root) return true;
      }
      return false;
    });
  }
}

function isWithin(node: Node, parts: Node[]): boolean {
  return parts.some((part) => node.start >= part.start && node.end <= part.end);
}

const methodNames = new WeakMap<Module, Set<string>>();

/** Whether the module defines a method or function-valued property called `name`, or assigns `x.name`. */
function definesMethod(module: Module, name: string): boolean {
  let names = methodNames.get(module);
  if (names === undefined) {
    names = new Set();
    const found = names;
    const add = (key: Node) => {
      if (is.Identifier(key)) found.add(key.name);
      else if (is.Literal(key) && typeof key.value === 'string') found.add(key.value);
    };
    module.walk({
      MethodDefinition: (node) => { if (!node.computed) add(node.key); },
      Property: (node) => { if (!node.computed && (node.method || is.Function(node.value))) add(node.key); },
      AssignmentExpression: (node) => {
        if (is.MemberExpression(node.left) && !node.left.computed) add(node.left.property);
      },
    });
    methodNames.set(module, names);
  }
  return names.has(name);
}

/** Array methods that change their receiver and nothing else. */
const ARRAY_EDITS = new Set(['push', 'pop', 'shift', 'unshift', 'reverse', 'splice', 'fill', 'sort']);
/** What changes a collection, by the global constructor that made it. */
const COLLECTION_EDITS: Record<string, readonly string[]> = {
  Map: ['set', 'delete', 'clear'], Set: ['add', 'delete', 'clear'], WeakMap: ['set', 'delete'], WeakSet: ['add', 'delete'],
};

/**
 * Whether `node` (a binding's name) is only the root of an edit, which reads nothing the object
 * holds (`wiki/compiler/handlers.md`, "Edits are not reads"): `x.a = v`, `delete x.a`,
 * `x.items.push(v)` with no callback, or `x.set(k, v)` where `x` is declared `const x = new Map()`.
 * The oracle's own statement of the rule, written apart from the compiler's.
 */
function onlyEdits(module: Module, node: Node): boolean {
  let target: Node = node;
  let parent = module.parentOf(target);
  while (is.MemberExpression(parent) && parent.object === target) {
    target = parent;
    parent = module.parentOf(target);
  }
  if (target === node) return false;
  if (is.AssignmentExpression(parent) && parent.left === target && parent.operator === '=') return true;
  if (is.UnaryExpression(parent) && parent.operator === 'delete' && parent.argument === target) return true;
  if (!is.CallExpression(parent) || parent.callee !== target || parent.optional) return false;
  if (!is.MemberExpression(target) || target.computed || !is.Identifier(target.property)) return false;
  if (parent.arguments.some((argument) => is.Function(argument) || is.SpreadElement(argument))) return false;
  const method = target.property.name;
  // A module that defines a method of that name (`{ push() {} }`) may mean its own.
  if (definesMethod(module, method)) return false;
  if (ARRAY_EDITS.has(method)) return true;
  if (target.object !== node) return false;
  // The collection itself, made with the global constructor and never reassigned.
  const binding = module.referenceOf(node)?.binding;
  const declarator = binding?.declarations.length === 1 ? module.parentOf(binding.declarations[0]!) : null;
  if (!is.VariableDeclarator(declarator) || declarator.init === null) return false;
  const declaration = module.parentOf(declarator);
  const init = declarator.init;
  if (!is.VariableDeclaration(declaration) || declaration.kind !== 'const' || !is.NewExpression(init)) return false;
  if (!is.Identifier(init.callee) || module.referenceOf(init.callee)?.binding != null) return false;
  return COLLECTION_EDITS[init.callee.name]?.includes(method) === true;
}

export function enclosingFunction(module: Module, node: Node): Node | undefined {
  let current = module.parentOf(node);
  while (current !== null && !is.Function(current)) current = module.parentOf(current);
  return current ?? undefined;
}
