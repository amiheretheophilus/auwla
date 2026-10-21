/** Emit native short-circuit selection without evaluating an inactive branch. */
import { b } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { ConditionalSelection } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, numberLiteral, statement } from '../../core/emit/quote';

export function emitSelection(selection: ConditionalSelection, names: Names, replacements: ReadonlyMap<Node, Node>) {
  const declarations: Statement[] = [];
  function choice(index: number, value: Expression = expression('void 0')): Expression {
    return expression('({ index: $$index, value: $$value })', {
      index: numberLiteral(index),
      value,
    });
  }

  function select(node: ConditionalSelection): Expression {
    if (node.kind === 'branch') {
      const value = node.value === null ? undefined : copy(node.value, replacements);
      return choice(node.index, value);
    }
    if (node.kind === 'test') {
      return b.ConditionalExpression({
        test: copy(node.test, replacements),
        consequent: select(node.consequent),
        alternate: select(node.alternate),
      });
    }

    // JavaScript returns the left value when it short-circuits. Keep that exact
    // value (including zero), and never evaluate the left operand twice.
    const left = names.fresh('_left');
    declarations.push(statement('let $$left;', { left }));
    const useRight = node.operator === '&&' ? expression('$$left', { left })
      : node.operator === '||' ? expression('!$$left', { left })
      : expression('$$left === null || $$left === void 0', { left });
    return b.SequenceExpression({
      expressions: [
        expression('$$left = $$value', { left, value: copy(node.left, replacements) }),
        b.ConditionalExpression({
          test: useRight,
          consequent: select(node.right),
          alternate: choice(node.fallback, expression('$$left', { left })),
        }),
      ],
    });
  }

  const value = select(selection);
  return { declarations, expression: value };
}
