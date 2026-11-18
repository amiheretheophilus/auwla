/** Recognize returned stored JSX through visible aliases and helper returns. */
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Module, Resolved } from '../../core/resolve';
import { importedDefinition } from '../../core/resolve';
import { variableDeclaration } from '../../core/graph/inputs';
import { functionValue, type FunctionNode } from '../../core/resolve/functions';

export function returnedMarkup(resolved: Resolved) {
  const entries = new Map(resolved.modules.map((entry) => [entry.module, entry]));
  const functionModules = new Map<Node, Module>();

  // Follow helpers by their resolved node identity. Matching by name would mix
  // unrelated helpers in different scopes or imported modules.
  for (const entry of resolved.modules) {
    const functions = entry.module.findAll([
      'FunctionDeclaration',
      'FunctionExpression',
      'ArrowFunctionExpression',
    ]);
    for (const fn of functions) {
      functionModules.set(fn, entry.module);
    }
  }

  return (fn: FunctionNode, module: Module): boolean => {
    // Aliases and recursive helpers can lead back to an expression already
    // visited during this component's search.
    const seen = new Set<Node>();

    function bindingReturnsMarkup(node: Extract<Node, { type: 'Identifier' }>, source: Module): boolean {
      const reference = source.referenceOf(node);
      if (reference?.binding === null || reference?.binding === undefined) {
        return false;
      }

      const binding = importedDefinition(reference.binding) ?? reference.binding;
      const declaration = variableDeclaration(binding);
      if (declaration?.init != null && containsReturnedMarkup(declaration.init, binding.module)) {
        return true;
      }

      for (const write of entries.get(binding.module)?.writes.get(binding) ?? []) {
        if (is.AssignmentExpression(write.node) && containsReturnedMarkup(write.node.right, binding.module)) {
          return true;
        }
      }
      return false;
    }

    function callReturnsMarkup(node: Extract<Node, { type: 'CallExpression' }>, source: Module): boolean {
      const called = functionValue(source, node.callee);
      if (called === null) {
        return false;
      }

      const calledModule = functionModules.get(called);
      return calledModule !== undefined && functionReturnsMarkup(called, calledModule);
    }

    function containsReturnedMarkup(root: Node, source: Module): boolean {
      if (seen.has(root)) {
        return false;
      }
      seen.add(root);

      let found = false;
      walk(root, {
        enter(node, context) {
          if (is.Function(node)) {
            context.skip();
            return;
          }

          if (is.JSXElement(node) || is.JSXFragment(node)) {
            found = true;
          } else if (is.Identifier(node)) {
            found = bindingReturnsMarkup(node, source);
          } else if (is.CallExpression(node)) {
            found = callReturnsMarkup(node, source);
          }

          if (found) {
            context.stop();
          }
        },
      });
      return found;
    }

    function functionReturnsMarkup(callable: FunctionNode, source: Module): boolean {
      if (callable.body === null) {
        return false;
      }
      if (!is.BlockStatement(callable.body)) {
        return containsReturnedMarkup(callable.body, source);
      }

      let found = false;
      walk(callable.body, {
        enter(node, context) {
          if (is.Function(node)) {
            context.skip();
            return;
          }

          if (is.ReturnStatement(node) && node.argument !== null) {
            found = containsReturnedMarkup(node.argument, source);
            context.skip();
            if (found) {
              context.stop();
            }
          }
        },
      });
      return found;
    }

    return functionReturnsMarkup(fn, module);
  };
}
