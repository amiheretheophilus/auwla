/** Render-only source captures for an automatic pending/error presentation site. */
import type * as t from '../ast/compiler-types';
import * as f from '../ast/factory';
import { analyzeScope, cloneNode, walkAst, type BaseNode } from '../ast';
import type { DomContext } from './context';
import { generatedIdentifier, mdd } from './identifiers';

type ImperativeExpression = t.Expression & { __memoDomImperativeCallback?: true };

/** Event/ref callbacks must always observe the authored, current source holder. */
export function imperativeCallback(expression: t.Expression): t.Expression {
  (expression as ImperativeExpression).__memoDomImperativeCallback = true;
  return expression;
}

export interface RetainedBranches { content: number; pending: readonly number[]; sources: readonly string[] }
type RetainedSite = t.Expression & { __memoDomRetainedBranches?: RetainedBranches };
export function retainedBranches(expression: t.Expression): RetainedBranches | undefined {
  return (expression as RetainedSite).__memoDomRetainedBranches;
}
export function retainAutomaticContent(expression: t.Expression, sources: readonly string[]): void {
  // Matches the error/error-throw/pending/empty/content ladder in data-sites.
  (expression as RetainedSite).__memoDomRetainedBranches = { content: 4, pending: [2, 3], sources };
}

/**
 * Independently scheduled descendants keep reading the last committed sources
 * while their parent's picker waits for a replacement. Never change authored
 * assignments, event callbacks, property keys, or shadowed local bindings.
 */
export function captureCommittedSources(
  ctx: DomContext, factory: t.ArrowFunctionExpression, sources: readonly string[],
): t.ArrowFunctionExpression {
  if (sources.length === 0) return factory;
  const program: t.Program = { type: 'Program', sourceType: 'module', body: [
    f.variableDeclaration('let', sources.map(source => f.variableDeclarator(f.identifier(source)))),
    f.expressionStatement(factory),
  ] };
  const analysis = analyzeScope(program);
  const imperative = new Set<BaseNode>();
  walkAst<BaseNode>(factory, { enter(node) {
    if ((node as ImperativeExpression).__memoDomImperativeCallback) {
      walkAst<BaseNode>(node, { enter(child) { imperative.add(child); } });
      return false;
    }
  } });
  const captures: Array<{ source: string; held: t.Identifier }> = [];
  for (const source of sources) {
    const references = analysis.rootScope.getBinding(source)?.references.filter(reference => !imperative.has(reference)) ?? [];
    if (references.length === 0) continue;
    const held = generatedIdentifier(ctx, 'committedSource');
    for (const reference of references) reference.name = held.name;
    captures.push({ source, held });
  }
  if (captures.length === 0) return factory;
  const body = factory.body as t.BlockStatement;
  const returned = body.body.at(-1);
  if (!f.isReturnStatement(returned) || !f.isObjectExpression(returned.argument)) throw new Error('memo-dom: invalid retained branch factory');
  const update = returned.argument.properties.find(property => f.isObjectProperty(property) && f.isIdentifier(property.key, { name: 'update' }));
  if (!update || !f.isObjectProperty(update) || !f.isExpression(update.value)) throw new Error('memo-dom: retained branch has no updater');
  returned.argument.properties.push(f.objectProperty(f.identifier('retain'), cloneNode(update.value)));
  returned.argument.properties.push(f.objectProperty(f.identifier('canRetain'), f.arrowFunctionExpression([],
    f.unaryExpression('!', f.callExpression(mdd(ctx, 'resolvedValuesPending'), [f.arrayExpression(captures.map(({ held }) => cloneNode(held)))])))));
  const reasons = generatedIdentifier(ctx, 'retainedReasons');
  update.value = f.arrowFunctionExpression([cloneNode(reasons)], f.blockStatement([
    ...captures.map(({ source, held }) => f.expressionStatement(f.assignmentExpression('=', cloneNode(held), f.identifier(source)))),
    f.expressionStatement(f.callExpression(update.value, [cloneNode(reasons)])),
  ]));
  body.body.unshift(f.variableDeclaration('let', captures.map(({ source, held }) => f.variableDeclarator(cloneNode(held), f.identifier(source)))));
  return factory;
}
