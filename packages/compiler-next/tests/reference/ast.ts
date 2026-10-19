/** Small builders shared by the test transforms, on top of yuku-ast. */
import { b } from 'yuku-ast';
import type { Expression, Statement } from 'yuku-parser';

export function identifier(name: string): Expression {
  return b.Identifier({ name });
}

export function member(object: string, property: string): Expression {
  return b.MemberExpression({
    object: identifier(object), property: b.Identifier({ name: property }),
    computed: false, optional: false,
  });
}

export function runtimeCall(name: string, args: Expression[]): Expression {
  return b.CallExpression({ callee: identifier(name), arguments: args, optional: false });
}

export function blockThunk(body: Statement[]): Expression {
  return b.ArrowFunctionExpression({
    id: null, params: [], body: b.BlockStatement({ body }),
    expression: false, async: false, generator: false,
  });
}

export function thunk(body: Expression): Expression {
  return b.ArrowFunctionExpression({
    id: null, params: [], body, expression: true, async: false, generator: false,
  });
}

export function numberLiteral(value: number): Expression {
  return b.Literal({ value, raw: String(value) });
}

export function constDeclaration(name: string, init: Expression): Statement {
  return b.VariableDeclaration({
    kind: 'const',
    declarations: [b.VariableDeclarator({ id: b.Identifier({ name }), init })],
  });
}
