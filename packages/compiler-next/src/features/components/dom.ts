/** Build props in authored order, leaving nested JSX to the shared copy pass. */
import { b, is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import { cleanJsxText, intrinsicTag } from '../../core/plan/jsx';
import { expression, stringLiteral } from '../../core/emit/quote';
import { copy } from '../../core/emit/copy';
import type { ComponentCall } from './plan';

export function emitComponentCall(call: ComponentCall, runtime: string, compiled = false): Expression {
  const intrinsic = intrinsicTag(call);
  let tag = intrinsic === null ? tagExpression(call.openingElement.name) : stringLiteral(intrinsic);
  if (compiled) {
    tag = expression('$$runtime.defineComponent($$tag)', { runtime, tag });
  }
  const properties: Extract<Expression, { type: 'ObjectExpression' }>['properties'] = [];
  for (const attribute of call.openingElement.attributes) {
    if (is.JSXSpreadAttribute(attribute)) {
      properties.push(b.SpreadElement({ argument: attribute.argument }));
      continue;
    }
    const name = is.JSXNamespacedName(attribute.name)
      ? `${attribute.name.namespace.name}:${attribute.name.name.name}`
      : attribute.name.name;
    properties.push(b.Property({
      key: stringLiteral(name),
      value: attributeValue(attribute.value),
      kind: 'init',
      method: false,
      shorthand: false,
      computed: false,
    }) as Extract<Expression, { type: 'ObjectExpression' }>['properties'][number]);
  }

  const children: Expression[] = [];
  for (const child of call.children) {
    if (is.JSXText(child)) {
      const text = cleanJsxText(child.value);
      if (text !== '') {
        children.push(stringLiteral(text));
      }
    } else if (is.JSXExpressionContainer(child)) {
      if (!is.JSXEmptyExpression(child.expression)) {
        children.push(child.expression);
      }
    } else if (is.JSXSpreadChild(child)) {
      children.push(b.SpreadElement({ argument: child.expression }) as unknown as Expression);
    } else {
      children.push(child as Expression);
    }
  }
  if (children.length > 0) {
    const single = children[0]!;
    const value = children.length === 1 && !is.SpreadElement(single)
      ? single
      : b.ArrayExpression({ elements: children });
    properties.push(b.Property({
      key: stringLiteral('children'), value, kind: 'init', method: false, shorthand: false, computed: false,
    }) as Extract<Expression, { type: 'ObjectExpression' }>['properties'][number]);
  }

  // The runtime extracts key after evaluating the object. This preserves key
  // expressions and spread getters in their native left-to-right order.
  return expression('$$runtime.createComponentValue($$tag, $$props)', {
    runtime, tag, props: b.ObjectExpression({ properties }),
  });
}

function attributeValue(value: Node | null): Expression {
  if (value === null) {
    return expression('true');
  }
  if (is.JSXExpressionContainer(value)) {
    return value.expression as Expression;
  }
  return value as Expression;
}

function tagExpression(tag: Node): Expression {
  if (is.JSXIdentifier(tag)) {
    // Copy retains authored identity for shared/local read replacements. A
    // fresh object spread would keep positions but lose that binding identity.
    const name = copy(tag) as unknown as Extract<Expression, { type: 'Identifier' }>;
    name.type = 'Identifier';
    return name;
  }
  if (is.JSXMemberExpression(tag)) {
    return b.MemberExpression({
      object: tagExpression(tag.object),
      property: b.Identifier({ name: tag.property.name }),
      computed: false,
      optional: false,
    });
  }
  throw new Error('memo-dom: invalid JSX tag syntax');
}
