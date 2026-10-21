/** Props are parameters of known component functions; ordinary helper parameters stay opaque. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Binding, Resolved } from '../../core/resolve';
import { declaringRunner, isParameter } from '../../core/resolve';
import { functionValue } from '../../core/resolve/functions';
import type { FunctionNode } from '../../core/resolve/functions';

export function propBindings(resolved: Resolved): ReadonlySet<Binding> {
  const components = new Set<FunctionNode>();
  for (const entry of resolved.modules) {
    const module = entry.module;
    for (const opening of module.findAll('JSXOpeningElement')) {
      const fn = functionValue(module, opening.name);
      if (fn !== null) components.add(fn);
    }

    // Markup belongs to its nearest function. Nested map/render callbacks own
    // their own markup, so their parameters are not claimed as props.
    const ownsMarkup = new Set<Node>();
    for (const jsx of module.findAll(['JSXElement', 'JSXFragment'])) {
      for (const ancestor of module.ancestors(jsx)) {
        if (is.Function(ancestor)) {
          ownsMarkup.add(ancestor);
          break;
        }
      }
    }

    for (const fn of module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])) {
      const parent = module.parentOf(fn);
      const name = fn.id ?? (is.VariableDeclarator(parent) && is.Identifier(parent.id) ? parent.id : null);
      if (name === null || !/^[A-Z]/.test(name.name)) continue;
      // Match the existing component convention: a capitalized function that returns markup.
      if (ownsMarkup.has(fn)) components.add(fn);
    }
  }

  const props = new Set<Binding>();
  for (const entry of resolved.modules) {
    for (const binding of entry.module.bindings) {
      if (!isParameter(binding)) continue;
      const owner = declaringRunner(entry.module, binding);
      if (owner === null || !is.Function(owner) || !components.has(owner as FunctionNode)) continue;
      const first = owner.params[0];
      if (first === undefined) continue;
      if (binding.declarations.some((name) => name.start >= first.start && name.end <= first.end)) props.add(binding);
    }
  }
  return props;
}
