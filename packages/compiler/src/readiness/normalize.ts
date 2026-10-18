/** Readiness normalizations, run before the component facts are read. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  childNode,
  cloneNode,
  overwriteNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../ast';
import { astBindingAt, memberKey } from '../context';
import { type DomContext as Ctx } from '../dom/context';
import { mdd } from '../dom/identifiers';
import { annotateAsyncRead } from '../planning/async-reads';
import { isPassthroughArgument, sourceBindings, sourceDependencies } from '../analysis/transparent-reads';
import { analyzeComponentReturns, returnPlanAsConditional } from '../components/return-plan';
import { summarizeHelper } from '../helper-summaries';

/**
 * Helpers that mix request-state and payload access keep the holder at their
 * call boundary. Only the proven payload reads inside the helper body read the
 * value, so `$track(source)` and `source.length` coexist without changing the
 * authored signature.
 */
export function lowerHelperPayloadReads(ctx: Ctx): void {
  for (const [name, helperPath] of ctx.helpers) {
    const summary = summarizeHelper(ctx, name);
    if (summary.parameterPayloadReads.length === 0) continue;
    const helper = helperPath.node;
    const helperNode = helper as unknown as BaseNode;
    const replacements: Array<{ expression: BaseNode; binding: string; site: string }> = [];
    for (const effect of summary.parameterPayloadReads) {
      const parameter = helper.params[effect.index];
      if (!astFactory.isIdentifier(parameter)) continue;
      const parameterBinding = astBindingAt(ctx, helperNode, parameter.name);
      if (parameterBinding === undefined) continue;
      const expected = [parameter.name, ...effect.path].join('.');
      walkAst(helperNode, {
        enter(current) {
          let matches = false;
          if (effect.path.length === 0 && current.type === 'Identifier') {
            matches = (current as unknown as AstIdentifier).name === parameter.name &&
              astBindingAt(ctx, current, parameter.name) === parameterBinding &&
              parameterBinding.references.includes(current as unknown as AstIdentifier);
          } else if (effect.path.length > 0 && current.type === 'MemberExpression') {
            matches = memberKey(current as unknown as t.MemberExpression) === expected &&
              astBindingAt(ctx, current, parameter.name) === parameterBinding;
          }
          if (!matches || isPassthroughArgument(ctx, current)) return;
          const parent = ctx.astAnalysis?.parentByNode.get(current) ?? null;
          if (
            (parent?.type === 'AssignmentExpression' && childNode(parent, 'left') === current) ||
            (parent?.type === 'UpdateExpression' && childNode(parent, 'argument') === current) ||
            (parent?.type === 'UnaryExpression' && (parent as unknown as t.UnaryExpression).operator === 'delete')
          ) return;
          const site = current.loc === null || current.loc === undefined
            ? ctx.moduleId
            : `${ctx.moduleId}:${current.loc.start.line}:${current.loc.start.column + 1}`;
          replacements.push({
            expression: current,
            binding: effect.path.length === 0 ? parameter.name : `${parameter.name}.${effect.path.join('.')}`,
            site,
          });
          return false;
        },
      });
    }
    for (const { expression, binding, site } of replacements) {
      overwriteNode(
        expression,
        annotateAsyncRead(astFactory.callExpression(mdd(ctx, 'readResolvedValue'), [
          cloneNode(expression, true) as unknown as t.Expression,
          astFactory.stringLiteral(binding),
          astFactory.stringLiteral(site),
        ]), [binding], 'throw', binding) as unknown as BaseNode,
      );
      ctx.usesTransparentData = true;
    }
  }
}

/** Local and imported source bindings a component can read. */
function componentSourceBindings(ctx: Ctx, component: string, node: BaseNode): Map<string, AstBinding> {
  const bindings = sourceBindings(ctx, node, ctx.transparentSources.get(component) ?? new Set<string>());
  for (const name of ctx.transparentModuleSources.keys()) {
    const binding = astBindingAt(ctx, node, name);
    if (binding?.kind === 'import') bindings.set(name, binding);
  }
  return bindings;
}

/**
 * `if (article.hidden) return <A/>; return <B/>;` chooses from loading data.
 * The chain becomes one returned conditional, a read site that waits for its
 * sources like `{article.hidden ? <A/> : <B/>}` in markup. Returns whether
 * any component changed.
 */
export function normalizeSourceReturns(ctx: Ctx): boolean {
  let changed = false;
  for (const [component, componentPath] of ctx.compPaths) {
    const bindings = componentSourceBindings(ctx, component, componentPath.node as unknown as BaseNode);
    if (bindings.size === 0) continue;
    const returns = analyzeComponentReturns(componentPath, component);
    if (!('pick' in returns)) continue;
    const eventSources = ctx.eventSourceSlots.get(component) ?? new Set<string>();
    const choosesFromSource = [...returns.statements].some(statement =>
      astFactory.isIfStatement(statement) &&
      sourceDependencies(ctx, statement.test as unknown as BaseNode, bindings, new Map(), eventSources).length > 0);
    if (!choosesFromSource) continue;
    const conditional = returnPlanAsConditional(returns);
    if (conditional === null) continue;
    const body = componentPath.node.body;
    body.body = [
      ...body.body.filter(statement => !returns.statements.has(statement)),
      astFactory.returnStatement(astFactory.jsxFragment(astFactory.jsxOpeningFragment(),
        astFactory.jsxClosingFragment(), [astFactory.jsxExpressionContainer(conditional)])),
    ];
    changed = true;
  }
  return changed;
}
