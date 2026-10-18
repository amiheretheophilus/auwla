/** Request-state dependencies: `$track(source)` facades and helpers that read a source's state. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../ast';
import { astBindingAt } from '../context';
import { type DomContext as Ctx } from '../dom/context';
import { isBoundTo, type TransparentDerivation } from '../analysis/transparent-reads';

export function trackDependencies(
  ctx: Ctx,
  root: BaseNode,
  tracks: ReadonlyMap<string, readonly string[]>,
  bindings: ReadonlyMap<string, AstBinding>,
  derived: ReadonlyMap<string, TransparentDerivation> = new Map(),
): string[] {
  const found = new Set<string>();
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const sources = tracks.get(name);
    const binding = astBindingAt(ctx, root, name);
    if (sources !== undefined) {
      if (binding === undefined || !isBoundTo(ctx, identifier, binding)) return;
      for (const source of sources) found.add(source);
      return;
    }
    const projection = derived.get(name);
    if (
      projection?.requestStateOnly === true &&
      isBoundTo(ctx, identifier, projection.binding)
    ) {
      for (const source of projection.sources) found.add(source);
    }
  };
  const atPath = (
    expression: t.CallExpression['arguments'][number] | undefined,
    path: readonly string[],
  ): BaseNode | null => {
    if (
      expression === undefined ||
      expression.type === 'SpreadElement'
    ) return null;
    let current = expression as unknown as BaseNode;
    for (const part of path) {
      if (current.type === 'ObjectExpression') {
        const property = (current as unknown as t.ObjectExpression).properties.find(candidate => {
          if (!astFactory.isObjectProperty(candidate) || candidate.computed) return false;
          return (astFactory.isIdentifier(candidate.key) && candidate.key.name === part) ||
            (astFactory.isStringLiteral(candidate.key) && candidate.key.value === part) ||
            (astFactory.isNumericLiteral(candidate.key) && String(candidate.key.value) === part);
        });
        if (property === undefined || !astFactory.isObjectProperty(property)) return null;
        current = property.value as unknown as BaseNode;
        continue;
      }
      if (current.type === 'ArrayExpression') {
        const index = Number(part);
        if (!Number.isInteger(index) || index < 0) return null;
        const element = (current as unknown as t.ArrayExpression).elements[index];
        if (element === null || element === undefined || element.type === 'SpreadElement') return null;
        current = element as unknown as BaseNode;
        continue;
      }
      return null;
    }
    return current;
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') {
        note(node);
        return;
      }
      if (node.type !== 'CallExpression') return;
      const call = node as unknown as t.CallExpression;
      if (astFactory.isIdentifier(call.callee)) {
        const binding = astBindingAt(
          ctx,
          call.callee as unknown as BaseNode,
          call.callee.name,
        );
        const summary = binding?.kind === 'import'
          ? ctx.importedFunctions.get(call.callee.name)
          : binding?.scope.isProgramScope === true
            ? ctx.helperSummaries.get(call.callee.name)
            : undefined;
        for (const effect of summary?.parameterSourceReads ?? []) {
          const argument = atPath(call.arguments[effect.index], effect.path);
          if (argument?.type !== 'Identifier') continue;
          const binding = bindings.get((argument as unknown as AstIdentifier).name);
          if (binding !== undefined && isBoundTo(ctx, argument, binding)) {
            found.add((argument as unknown as AstIdentifier).name);
          }
        }
      }
      if (
        !astFactory.isIdentifier(call.callee) ||
        !ctx.transparentTrackFactories.has(call.callee.name) ||
        astBindingAt(ctx, node, call.callee.name)?.kind !== 'import'
      ) return;
      const argument = call.arguments[0];
      if (!astFactory.isIdentifier(argument)) return;
      const binding = bindings.get(argument.name);
      if (
        binding !== undefined &&
        isBoundTo(ctx, argument as unknown as BaseNode, binding)
      ) found.add(argument.name);
    },
  });
  return [...found].sort();
}
