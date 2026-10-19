/**
 * `key` outside a list row (React semantics).
 *
 * A literal key never changes, so it has no effect and is dropped. A dynamic
 * key remounts its element when it changes, which is exactly a keyed list of
 * one row: `<Form key={id} />` becomes `{[id].map(_key => <Form key={_key} />)}`
 * and the list machinery replaces the row when the key differs.
 *
 * Elements returned from a nested function (list rows, render callbacks,
 * helpers) keep their key for the passes that own those forms.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { nodeFields as fields, walkAst, type BaseNode } from '../ast';
import type { DomContext as Ctx } from '../dom/context';
import { generatedIdentifier } from '../dom/identifiers';

interface StrayKey {
  element: t.JSXElement;
  attribute: t.JSXAttribute;
  parent: BaseNode;
  key: string;
  index: number | undefined;
}

/** Returns whether any element was rewritten (the scope index is then stale). */
export function normalizeStrayKeys(ctx: Ctx): boolean {
  let changed = false;
  for (const [, path] of ctx.compPaths) {
    const component = path.node as unknown as BaseNode;
    const functions: BaseNode[] = [];
    const found: StrayKey[] = [];
    walkAst<BaseNode>(component, {
      enter(node, parent, key, index) {
        if (isFunction(node)) functions.push(node);
        if (node.type !== 'JSXElement' || parent === null || key === undefined) return;
        const element = node as unknown as t.JSXElement;
        const attribute = element.openingElement.attributes.find(
          (candidate): candidate is t.JSXAttribute =>
            !astFactory.isJSXSpreadAttribute(candidate) &&
            astFactory.isJSXIdentifier(candidate.name, { name: 'key' }),
        );
        if (attribute === undefined || returnedFromNestedFunction(parent, functions.at(-1), component)) return;
        found.push({ element, attribute, parent, key, index });
      },
      leave(node) {
        if (isFunction(node)) functions.pop();
      },
    });
    for (const stray of found) rewrite(ctx, stray);
    if (found.length > 0) changed = true;
  }
  return changed;
}

function isFunction(node: BaseNode): boolean {
  return node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration';
}

function returnedFromNestedFunction(
  parent: BaseNode,
  fn: BaseNode | undefined,
  component: BaseNode,
): boolean {
  if (fn === undefined || fn === component) return false;
  return parent === fn || parent.type === 'ReturnStatement';
}

function rewrite(ctx: Ctx, { element, attribute, parent, key, index }: StrayKey): void {
  const value = attribute.value;
  const expression = astFactory.isJSXExpressionContainer(value) && !astFactory.isJSXEmptyExpression(value.expression)
    ? value.expression as t.Expression
    : null;
  if (expression === null || isLiteral(expression)) {
    element.openingElement.attributes = element.openingElement.attributes.filter(candidate => candidate !== attribute);
    return;
  }
  const row = generatedIdentifier(ctx, 'key');
  attribute.value = astFactory.jsxExpressionContainer(astFactory.identifier(row.name));
  const list = astFactory.jsxExpressionContainer(
    astFactory.callExpression(
      astFactory.memberExpression(astFactory.arrayExpression([expression]), astFactory.identifier('map')),
      [astFactory.arrowFunctionExpression([astFactory.identifier(row.name)], element)],
    ),
  );
  const childOfJsx = parent.type === 'JSXElement' || parent.type === 'JSXFragment';
  const replacement = childOfJsx
    ? list
    : astFactory.jsxFragment(astFactory.jsxOpeningFragment(), astFactory.jsxClosingFragment(), [list]);
  const slot = fields(parent)[key];
  if (Array.isArray(slot)) slot[index!] = replacement;
  else fields(parent)[key] = replacement;
}

function isLiteral(expression: t.Expression): boolean {
  return astFactory.isStringLiteral(expression) || astFactory.isNumericLiteral(expression) ||
    astFactory.isBooleanLiteral(expression) || astFactory.isNullLiteral(expression) ||
    (astFactory.isTemplateLiteral(expression) && expression.expressions.length === 0);
}
