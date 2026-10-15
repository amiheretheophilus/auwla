import type * as t from '../ast/compiler-types';
import * as f from '../ast/factory';
import { cloneNode } from '../ast';
import type { DomContext } from './context';
import { generatedIdentifier, md } from './identifiers';
import { registerStmt, type EmitScope } from './scope';
import { preparationRead, subscribeTransparentStructuralSite } from './data-subscriptions';
import { asyncReadFact } from '../planning/async-reads';

export function emitContentRegion(ctx: DomContext, scope: EmitScope, parent: string, owner: t.Expression, expression: t.Expression): void {
  const variable = generatedIdentifier(ctx, 'contentRegion');
  const sources = asyncReadFact(expression)?.sources ?? [];
  const id = f.binaryExpression('+', cloneNode(owner), f.stringLiteral(`/$content${scope.dataSiteCounter.count++}`));
  const update = () => f.expressionStatement(f.callExpression(f.memberExpression(cloneNode(variable), f.identifier('update')), []));
  scope.creation.push(registerStmt(ctx, cloneNode(id), cloneNode(owner), f.arrowFunctionExpression([], f.blockStatement([update()]))));
  scope.creation.push(f.variableDeclaration('const', [f.variableDeclarator(variable,
    f.callExpression(md(ctx, 'createContentRegion'), [f.identifier(parent), cloneNode(id),
      f.arrowFunctionExpression([], preparationRead(ctx, scope, id, cloneNode(expression), sources)),
    ]))]));
  scope.updaters.push(update);
  subscribeTransparentStructuralSite(ctx, scope, expression, id, sources);
  scope.disposableRegions.push(variable.name);
  scope.disposableEntities.push(id);
}
