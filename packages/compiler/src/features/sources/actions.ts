/** Validate framework actions reached by setup, without treating callbacks as calls. */
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { CompileError } from '../../core/diagnostics';
import type { SemanticGraph } from '../../core/graph';
import type { Module, ResolvedModule } from '../../core/resolve';
import { functionValue } from '../../core/resolve/functions';
import { dataApi, fetchMethod } from './classify';

export function validateSourceActions(graph: SemanticGraph, entry: ResolvedModule, components: ReadonlySet<Node>): void {
  const summaries = new Map(graph.functions.map((summary) => [summary.fn, summary]));

  const visit = (root: Node, module: Module, visited: ReadonlySet<Node>, facade?: string): void => {
    walk(root, { enter(node, context) {
      if (is.Function(node)) {
        context.skip();
        return;
      }

      if (!is.CallExpression(node)) {
        return;
      }

      if (dataApi(module, node.callee) === '$fetch') {
        const method = fetchMethod(node);
        const target = node.arguments[0];
        const paused = is.NullLiteral(target);

        if (!paused && method !== null && method !== 'GET') {
          const name = facade ?? (is.Identifier(node.callee) ? node.callee.name : '$fetch');
          const owner = graph.resolved.modules.find((candidate) => candidate.module === module)!;

          throw CompileError.at(
            `\`${name}\` is a ${method} action: call it from an event handler, $effect or deferred callback. To load data, use GET.`,
            owner.path,
            module.source,
            node.start,
          );
        }

        return;
      }

      const fn = functionValue(module, node.callee);
      const summary = fn === null ? undefined : summaries.get(fn);

      if (fn === null || summary === undefined || fn.body === null || visited.has(fn)) {
        return;
      }

      const next = new Set(visited).add(fn);
      const name = facade ?? (is.Identifier(node.callee) ? node.callee.name : undefined);

      for (const parameter of fn.params) {
        visit(parameter, summary.module, next, name);
      }

      visit(fn.body, summary.module, next, name);
    } });
  };

  for (const statement of entry.module.ast.body) {
    visit(statement, entry.module, new Set());
  }

  for (const fn of entry.module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])) {
    if (!components.has(fn) || fn.body === null) {
      continue;
    }

    for (const parameter of fn.params) {
      visit(parameter, entry.module, new Set([fn]));
    }

    visit(fn.body, entry.module, new Set([fn]));
  }
}
