/** The key a module-level component is defined under (`wiki/compiler/components.md`, "Keys"). */
import { is } from 'yuku-ast';
import type { Module } from 'yuku-analyzer';
import type { Node } from 'yuku-parser';

/**
 * `./App.tsx#App`: the root id `mount()` gives the component, and what hot replacement matches a
 * new definition by after an edit (`runtime/src/hot.ts`). So it is the component's name wherever
 * it has one, never an offset that an edit above the component would move.
 */
export function componentKey(module: Module, path: string, fn: Node): string {
  const name = componentNameNode(module, fn);
  if (name !== null) {
    return `${path}#${name.name}`;
  }

  // `export default () => …`: a module has one default export.
  if (is.ExportDefaultDeclaration(outerParent(module, fn).parent)) {
    return `${path}#default`;
  }

  return `${path}#${fn.start}`;
}

/**
 * The identifier naming a component function: its own (`function Card`), or the variable it
 * initializes (`const Card = () => …`, through parentheses). Null when it has neither.
 */
export function componentNameNode(module: Module, fn: Node): Extract<Node, { type: 'Identifier' }> | null {
  const id = (fn as { id?: Node | null }).id;
  if (id != null && is.Identifier(id)) {
    return id;
  }

  const { child, parent } = outerParent(module, fn);
  if (parent !== null && is.VariableDeclarator(parent) && parent.init === child && is.Identifier(parent.id)) {
    return parent.id;
  }

  return null;
}

/** The node holding `node`, past any parentheses around it, and the outermost of those. */
function outerParent(module: Module, node: Node): { child: Node; parent: Node | null } {
  let child = node;
  let parent = module.parentOf(node) ?? null;
  while (parent !== null && is.ParenthesizedExpression(parent)) {
    child = parent;
    parent = module.parentOf(parent) ?? null;
  }
  return { child, parent };
}
