/** What code reads, on yuku's binding and reference model. Test-only. */
import type { Binding, Module, Reference } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';

type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;

/** Finds the bindings a piece of code reads. A local function stands for what it reads. */
export class Reads {
  constructor(private readonly module: Module) {}

  /** Everything read anywhere inside `roots`, including inside callbacks they contain. */
  inside(roots: Node[], exclude: Binding | undefined): Set<Binding> {
    const found = new Set<Binding>();
    for (const root of roots) this.collect(root, root, false, found, new Set());
    if (exclude) found.delete(exclude);
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

  private collect(root: Node, scope: Node, directOnly: boolean, found: Set<Binding>, visited: Set<Node>): void {
    const visit = (reference: Reference | null) => {
      const binding = reference?.binding;
      if (!binding || reference.isWrite || reference.inTypePosition) return;
      if (this.isDeclaredInside(binding, scope)) return;
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

export function enclosingFunction(module: Module, node: Node): Node | undefined {
  let current = module.parentOf(node);
  while (current !== null && !is.Function(current)) current = module.parentOf(current);
  return current ?? undefined;
}
