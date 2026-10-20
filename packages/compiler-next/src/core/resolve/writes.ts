/**
 * Write sites: every place code may change a binding's value. yuku's references
 * see reassignment (`isWrite`) but not mutation (`wiki/compiler/toolchain.md`),
 * so mutation is found here, attributed to the binding at its root:
 * `user.address.city = 'x'` and `items.push(x)` write `user` and `items`.
 *
 * Bindings at any scope are covered alike: a component, a module, a helper, a
 * factory closure, a class (`wiki/compiler/output.md`, "State lives anywhere").
 */
import type { Binding, Module, Reference } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';

export type WriteKind =
  /** `x = 1`, `x += 1`, `[x] = pair`, `for (x of xs)` */
  | 'assign'
  /** `x++`, `--x` */
  | 'update'
  /** `x.a = 1`, `x.a += 1`, `x.a++` */
  | 'member'
  /** `delete x.a` */
  | 'delete'
  /** `x.push(1)`, `x.list.push(1)`: any method call may change its receiver */
  | 'call'
  /** `f(x)`, `new F(x.list)`: the callee may change what it is given */
  | 'argument';

/** A property step from the root: a name, or `null` for a computed key (`x[i]`). */
export type PathKey = string | null;

export interface WriteSite {
  readonly kind: WriteKind;
  readonly binding: Binding;
  /** The root name, `items` in `items.list.push(x)`. */
  readonly reference: Reference;
  /** Steps from the root to what changes: `['list']` for `items.list.push(x)`. */
  readonly path: readonly PathKey[];
  /** For `call`: the method, `push`. Null when computed (`x[name]()`). */
  readonly method?: PathKey;
  /** The assignment, update, `delete`, or call expression. */
  readonly node: Node;
  /**
   * Lexical placement only. `body` shares the declaring runner; `later` has a
   * different runner, such as a nested callback or instance field initializer.
   * A callback can still execute immediately. This flag must not classify a
   * binding as a snapshot; invocation context decides whether a write takes over.
   */
  readonly timing: 'body' | 'later';
  /** The function (or instance field) whose run performs the write; null at module top level. */
  readonly runner: Node | null;
}

/** Every write site in the module, grouped by binding. */
export function findWrites(module: Module): Map<Binding, WriteSite[]> {
  const writes = new Map<Binding, WriteSite[]>();

  for (const reference of module.references) {
    const binding = reference.binding;
    if (binding === null || reference.inTypePosition) continue;

    const site = writeAt(module, reference, binding);
    if (site === undefined) continue;

    const list = writes.get(binding) ?? [];
    list.push(site);
    writes.set(binding, list);
  }
  return writes;
}

function writeAt(module: Module, reference: Reference, binding: Binding): WriteSite | undefined {
  const declaredIn = declaringRunner(module, binding);
  const timing = (node: Node) => {
    const runner = runnerOf(module, node);
    return { runner, timing: runner === declaredIn ? 'body' as const : 'later' as const };
  };

  if (reference.isWrite) {
    const parent = outerParent(module, reference.node);
    const kind = is.UpdateExpression(parent) ? 'update' : 'assign';
    const node = parent ?? reference.node;
    return { kind, binding, reference, path: [], node, ...timing(node) };
  }

  // Climb `x.a.b` to its outermost member expression.
  const path: PathKey[] = [];
  let chain: Node = reference.node;
  let parent = outerParent(module, chain);
  while (is.MemberExpression(parent) && unwrapped(parent.object) === chain) {
    path.push(!parent.computed && is.Identifier(parent.property) ? parent.property.name : null);
    chain = parent;
    parent = outerParent(module, chain);
  }

  if (path.length > 0) {
    if (is.AssignmentExpression(parent) && unwrapped(parent.left) === chain) {
      return { kind: 'member', binding, reference, path, node: parent, ...timing(parent) };
    }
    if (is.UpdateExpression(parent)) {
      return { kind: 'member', binding, reference, path, node: parent, ...timing(parent) };
    }
    if (is.UnaryExpression(parent) && parent.operator === 'delete') {
      return { kind: 'delete', binding, reference, path, node: parent, ...timing(parent) };
    }
    if (is.CallExpression(parent) && unwrapped(parent.callee) === chain) {
      const receiver = path.slice(0, -1);
      const method = path.at(-1)!;
      return { kind: 'call', binding, reference, path: receiver, method, node: parent, ...timing(parent) };
    }
  }

  const isArgument = (is.CallExpression(parent) || is.NewExpression(parent))
    && parent.arguments.some((argument) => unwrapped(argument) === chain);
  if (isArgument) {
    return { kind: 'argument', binding, reference, path, node: parent!, ...timing(parent!) };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers

/** Wrappers that do not change which value an expression is. */
function isTransparent(node: Node): boolean {
  return is.ParenthesizedExpression(node)
    || is.TSNonNullExpression(node)
    || is.TSAsExpression(node)
    || is.TSSatisfiesExpression(node)
    || is.TSTypeAssertion(node)
    || is.ChainExpression(node);
}

/** The parent of `node`, past `(x)`, `x!`, `x as T` and `x?.` wrappers. */
function outerParent(module: Module, node: Node): Node | null {
  let parent = module.parentOf(node);
  while (parent !== null && isTransparent(parent)) parent = module.parentOf(parent);
  return parent;
}

/** `node` without its wrappers. */
function unwrapped(node: Node): Node {
  let current = node;
  while (isTransparent(current) && 'expression' in current) {
    current = (current as { expression: Node }).expression;
  }
  return current;
}

/**
 * The code that declares a binding. A parameter belongs to its function; the
 * name of a function or class declaration belongs to the code around it.
 */
export function declaringRunner(module: Module, binding: Binding): Node | null {
  const name = binding.declarations[0]!;
  const parent = module.parentOf(name);
  const namesItsParent = parent !== null
    && (is.Function(parent) || is.Class(parent))
    && (parent as { id?: Node | null }).id === name;
  return runnerOf(module, namesItsParent ? parent : name);
}

/**
 * The code whose run executes `node`: its nearest enclosing function, or an
 * instance field initializer (it runs at construction). Static fields and static
 * blocks run with the class, so they belong to the code around the class. Null at
 * module top level.
 */
export function runnerOf(module: Module, node: Node): Node | null {
  let child = node;
  let current = module.parentOf(node);
  while (current !== null) {
    if (is.Function(current)) return current;
    if (is.PropertyDefinition(current) && !current.static && current.value === child) return current;
    child = current;
    current = module.parentOf(current);
  }
  return null;
}
