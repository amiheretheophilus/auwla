/** Props are parameters of known component functions; ordinary helper parameters stay opaque. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Binding, Resolved } from '../../core/resolve';
import { declaringRunner, isParameter, isRuntimeBinding } from '../../core/resolve';
import { functionValue } from '../../core/resolve/functions';
import type { FunctionNode } from '../../core/resolve/functions';
import { returnedMarkup } from './returns';

/** Functions used as a JSX tag, and capitalized functions that own markup. */
export function componentFunctions(resolved: Resolved): ReadonlySet<FunctionNode> {
  const components = new Set<FunctionNode>();
  const returnsMarkup = returnedMarkup(resolved);
  for (const entry of resolved.modules) {
    const module = entry.module;
    for (const opening of module.findAll('JSXOpeningElement')) {
      const fn = functionValue(module, opening.name);
      if (fn !== null) {
        components.add(fn);
      }
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
      let name = fn.id ?? (is.VariableDeclarator(parent) && is.Identifier(parent.id) ? parent.id : null);
      if (name === null && is.Property(parent) && !parent.computed && is.Identifier(parent.key)) {
        name = parent.key;
      }
      if (name === null || !/^[A-Z]/.test(name.name)) {
        continue;
      }
      // A component can return a stored value through a helper without owning
      // any JSX directly. Keep the same capitalized-function convention.
      if (ownsMarkup.has(fn) || returnsMarkup(fn, module)) {
        components.add(fn);
      }
    }
  }
  return components;
}

/** The parameters of components: the props object, or the names destructured from it. */
export function propBindings(
  resolved: Resolved,
  components: ReadonlySet<FunctionNode>,
): ReadonlySet<Binding> {
  const props = new Set<Binding>();
  for (const entry of resolved.modules) {
    for (const binding of entry.module.bindings) {
      if (!isParameter(binding) || !isRuntimeBinding(binding)) {
        continue;
      }
      const owner = declaringRunner(entry.module, binding);
      if (owner === null || !is.Function(owner) || !components.has(owner as FunctionNode)) {
        continue;
      }
      // Declared in the component's own parameter list (any position: a map
      // callback receives index and array too), not in a nested function's.
      const declared = binding.declarations.some((name) => owner.params.some((param) => {
        return name.start >= param.start && name.end <= param.end;
      }));
      if (declared) {
        props.add(binding);
      }
    }
  }
  return props;
}
