/** Emit native short-circuit selection without evaluating an inactive branch. */
import { b } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { ConditionalSelection, FunctionScoped } from '../../core/plan/model';
import { declarationAssignments, patternNames } from '../../core/emit/patterns';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, numberLiteral, statement } from '../../core/emit/quote';

/** The emitted code of deferred setup statements, run once when first reached. */
export type EmitOnce = (statements: readonly Statement[]) => Statement[];

export function emitSelection(
  selection: ConditionalSelection,
  names: Names,
  replacements: ReadonlyMap<Node, Node>,
  once?: EmitOnce,
) {
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
    if (node.kind === 'program') {
      return program(node);
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

  /**
   * The component tail as a native arrow, so `this`, `arguments` and block
   * scopes behave as written. Each authored return gives its branch choice.
   */
  function program(node: Extract<ConditionalSelection, { kind: 'program' }>): Expression {
    const local = new Map(replacements);
    for (const [returned, selected] of node.returns) {
      local.set(returned, b.ReturnStatement({ argument: select(selected) }));
    }
    // A `var` belongs to the component's scope: declare it there, and assign
    // it where it was written. Each run of the selector is one run of the
    // authored body, so it starts with each `var` undefined again.
    const body: Statement[] = [];
    for (const scoped of node.functionScoped) {
      const declared = scoped.declaration.declarations.flatMap((declarator) => patternNames(declarator.id));
      declarations.push(statement(`var ${declared.join(', ')};`, {}));
      body.push(...declared.map((name) => statement(`${name} = void 0;`, {})));
      local.set(scoped.declaration, assignedInPlace(scoped));
    }
    for (const step of node.steps) {
      if (step.kind === 'native') {
        body.push(copy(step.statement, local));
      } else if (once !== undefined) {
        body.push(...once(step.statements));
      }
    }
    if (node.fallthrough !== null) {
      body.push(b.ReturnStatement({ argument: choice(node.fallthrough) }));
    }
    const run = names.fresh('_select');
    const arrow = b.ArrowFunctionExpression({
      id: null,
      params: [],
      body: b.BlockStatement({ body }),
      async: false,
      generator: false,
      expression: false,
    });
    declarations.push(statement('const $$run = $$arrow;', { run, arrow }));
    return expression('$$run()', { run });
  }

  const value = select(selection);
  return { declarations, expression: value };
}

/** A hoisted `var` declaration, written as what it does where it stands. */
function assignedInPlace(scoped: FunctionScoped): Node {
  const assignments = declarationAssignments(scoped.declaration);
  if (scoped.position === 'for-left') {
    return scoped.declaration.declarations[0]!.id;
  }
  if (scoped.position === 'for-init') {
    return assignments ?? expression('void 0');
  }
  return assignments === null ? b.EmptyStatement({}) : b.ExpressionStatement({ expression: assignments });
}
