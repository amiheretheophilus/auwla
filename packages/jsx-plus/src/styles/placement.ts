import { parse, TokenKind as K, type Node } from 'yuku-parser';
import { closingDelimiter } from '../host';

type Placement =
  | { readonly kind: 'module' }
  | { readonly kind: 'function'; readonly owner: number }
  | { readonly kind: 'nested' }
  | { readonly kind: 'expression' };

/**
 * Let the host parser decide where a neutral statement lands. Close the prefix's
 * delimiters: Yuku deliberately drops an unfinished function body during recovery.
 * A return/initializer is an expression, so a DOM `<style>` stays ordinary JSX.
 */
export function stylePlacement(prefix: string): Placement {
  const tokens = parse(prefix, { lang: 'tsx', sourceType: 'module', tokens: true }).tokens!;
  const closers: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const kind = tokens.kind(index);
    const close = closingDelimiter(kind);
    if (close !== undefined) {
      closers.push(close);
    } else if (closers.at(-1) === kind) {
      closers.pop();
    }
  }
  const text = new Map<number, string>([
    [K.RightBrace, ';}'], [K.RightParen, ')'], [K.RightBracket, ']'], [K.TemplateTail, '}`'],
  ]);
  const suffix = closers.reverse().map((close) => text.get(close)).join('');
  const { program } = parse(`${prefix}0${suffix};`, { lang: 'tsx', sourceType: 'module' });
  let placement: Placement = { kind: 'expression' };

  function visit(node: Node, ancestors: readonly Node[]): void {
    if (node.type === 'ExpressionStatement' && node.start === prefix.length
      && node.expression.type === 'Literal') {
      const parent = ancestors.at(-1);
      const owner = ancestors.at(-2);

      if (parent?.type === 'Program') {
        placement = { kind: 'module' };
      } else if (parent?.type === 'BlockStatement' && owner !== undefined
        && (owner.type === 'FunctionDeclaration' || owner.type === 'FunctionExpression'
          || owner.type === 'ArrowFunctionExpression') && owner.body === parent) {
        placement = { kind: 'function', owner: owner.start };
      } else {
        placement = { kind: 'nested' };
      }
      return;
    }

    // Parser nodes contain child nodes and data, with no parent cycles.
    for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (child !== null && typeof child === 'object' && typeof child.type === 'string') {
          visit(child as Node, [...ancestors, node]);
        }
      }
    }
  }

  visit(program, []);
  return placement;
}
