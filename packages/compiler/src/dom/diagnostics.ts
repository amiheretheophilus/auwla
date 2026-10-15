/** Optional development emission. Diagnostic names never participate in analysis. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode, isReferenceIdentifier, walkAst } from '../ast';
import type { DomContext } from './context';
import { componentId, md, mdTrace } from './identifiers';
import type { ScopeWrites } from '../handlers/write-facts';
import type { RowCtx } from './row-context';

export function diagnosticSources(expression: t.Expression): string[] {
  const names = new Set<string>();
  walkAst(expression, { enter(node, parent, key) {
    if (astFactory.isIdentifier(node) && (parent === null || isReferenceIdentifier(parent, key))) names.add(node.name);
    // Function bodies are not evaluated by evaluating a function value.
    if (astFactory.isFunctionExpression(node) || astFactory.isArrowFunctionExpression(node)) return false;
  } });
  return [...names].sort();
}

export function diagnosticSourceArray(sources: readonly string[]): t.ArrayExpression {
  return astFactory.arrayExpression(sources.map(source => astFactory.stringLiteral(source)));
}

export function traceDomWrite(
  ctx: DomContext, owner: t.Expression, operation: string, expression: t.Expression, write: t.Statement,
): t.Statement {
  if (!ctx.diagnostics) return write;
  return astFactory.blockStatement([write, astFactory.expressionStatement(astFactory.callExpression(mdTrace(ctx, 'traceDom'), [
    cloneNode(owner), astFactory.stringLiteral(operation), diagnosticSourceArray(diagnosticSources(expression)),
  ]))]);
}

export function traceHandler(ctx: DomContext, owner: t.Expression, type: string, handler: t.Expression): t.Expression {
  if (ctx.scopedEvents) handler = astFactory.callExpression(md(ctx,'bindRuntimeCallback'), [handler]);
  return ctx.diagnostics ? astFactory.callExpression(mdTrace(ctx, 'traceEvent'), [
    cloneNode(owner), astFactory.stringLiteral(type), handler,
  ]) : handler;
}

/** Attach only after write-commit coalescing, never as an optimization input. */
export function traceCommit(
  ctx: DomContext, writes: ScopeWrites, component: string | null, row: RowCtx | undefined, commit: t.Statement,
): t.Statement {
  if (!ctx.diagnostics) return commit;
  const sources = [...new Set([
    ...writes.writes, ...writes.instanceWrites, ...writes.transparentWrites, ...writes.listItemWrites.keys(),
  ])].sort();
  const owner = row ? astFactory.identifier(row.rowIdVar)
    : component !== null ? componentId(ctx, component) : astFactory.stringLiteral(ctx.rootId);
  return astFactory.blockStatement([
    astFactory.expressionStatement(astFactory.callExpression(mdTrace(ctx, 'traceWrite'), [
      owner, diagnosticSourceArray(sources), astFactory.booleanLiteral(writes.rootFallback || writes.eventFallback),
    ])), commit,
  ]);
}
