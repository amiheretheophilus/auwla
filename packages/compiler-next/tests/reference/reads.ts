/** What code reads, on yuku's binding and reference model. Test-only. */
import type { Binding, Module, Reference } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';

type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;

/** Finds the bindings a piece of code reads. A local function stands for what it reads. */
export class Reads {
  constructor(private readonly module: Module) {}

  /**
   * Everything read anywhere inside `roots`, including inside callbacks they
   * contain. Reads inside `skip` (parts of a root) are left out.
   */
  inside(roots: Node[], exclude: Binding | undefined, skip: Node[] = []): Set<Binding> {
    const found = new Set<Binding>();
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
      if (this.functionOf(binding) !== undefined) return;

      const path: string[] = [];
      let node: Node = reference.node;
      let parent = this.module.parentOf(node);
      while (is.MemberExpression(parent) && parent.object === node && !parent.computed && is.Identifier(parent.property)) {
        path.push(parent.property.name);
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
   * local functions it calls. Reads inside callbacks it creates run later, so they
   * are not inputs (`connection.onMessage(() => unread++)`). Updates (`runs++`) are
   * writes, not reads.
   */
  ofCallback(callback: Expression): Set<Binding> {
    const found = new Set<Binding>();
    let fn: Node | undefined = callback;
    if (is.Identifier(callback)) {
      const binding = this.module.referenceOf(callback)?.binding;
      fn = binding ? this.functionOf(binding) : undefined;
    }
    if (fn !== undefined && is.Function(fn)) this.collect(fn, fn, true, found, new Set([fn]));
    return found;
  }

  private collect(
    root: Node,
    scope: Node,
    directOnly: boolean,
    found: Set<Binding>,
    visited: Set<Node>,
    skip: Node[] = [],
  ): void {
    const visit = (reference: Reference | null) => {
      const binding = reference?.binding;
      if (!binding || reference.isWrite || reference.inTypePosition) return;
      if (this.isDeclaredInside(binding, scope)) return;
      if (isWithin(reference.node, skip)) return;
      if (directOnly && enclosingFunction(this.module, reference.node) !== scope) return;

      const fn = this.functionOf(binding);
      if (fn === undefined) {
        found.add(binding);
      } else if (!visited.has(fn)) {
        visited.add(fn);
        this.collect(fn, fn, directOnly, found, visited);
      }
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
      if (reference?.binding && !reference.isWrite && !reference.inTypePosition) found.add(reference.binding);
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

  /** The function a binding names: `function f() {}` or `const f = () => {}`. */
  functionOf(binding: Binding): FunctionNode | undefined {
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

export function enclosingFunction(module: Module, node: Node): Node | undefined {
  let current = module.parentOf(node);
  while (current !== null && !is.Function(current)) current = module.parentOf(current);
  return current ?? undefined;
}
