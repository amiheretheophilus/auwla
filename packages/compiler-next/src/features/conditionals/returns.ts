/** Fold return-only tails into a lazy selection plan; never edit authored syntax. */
import { b, is, walk } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';

export function hasReturn(root: Node): boolean {
  let found = false;
  walk(root, { enter(node, context) {
    if (is.Function(node)) context.skip();
    else if (is.ReturnStatement(node)) { found = true; context.stop(); }
  } });
  return found;
}

export function planReturns(body: readonly Statement[], unsupported: (node: Node) => never) {
  const first = body.findIndex(hasReturn);
  const setup = first < 0 ? body : body.slice(0, first);
  const tail = first < 0 ? [] : body.slice(first);
  const validate = (statement: Statement): void => {
    if (is.ReturnStatement(statement) || is.EmptyStatement(statement)) return;
    if (is.BlockStatement(statement)) { for (const entry of statement.body) validate(entry as Statement); return; }
    if (is.IfStatement(statement)) {
      validate(statement.consequent as Statement);
      if (statement.alternate !== null) validate(statement.alternate as Statement);
      return;
    }
    unsupported(statement);
  };
  for (const statement of tail) validate(statement);
  const empty = b.UnaryExpression({ operator: 'void', prefix: true, argument: b.Literal({ value: 0, raw: '0' }) });
  const fold = (statements: readonly Statement[], fallback: Expression): Expression => {
    const [statement, ...rest] = statements;
    if (statement === undefined) return fallback;
    if (is.ReturnStatement(statement)) return statement.argument ?? empty;
    const continuation = fold(rest, fallback);
    if (is.EmptyStatement(statement)) return continuation;
    if (is.BlockStatement(statement)) return fold(statement.body as Statement[], continuation);
    if (!is.IfStatement(statement)) return unsupported(statement);
    return b.ConditionalExpression({
      test: statement.test,
      consequent: fold([statement.consequent as Statement], continuation),
      alternate: statement.alternate === null ? continuation : fold([statement.alternate as Statement], continuation),
    });
  };
  return { setup: [...setup], expression: fold(tail, empty) };
}
