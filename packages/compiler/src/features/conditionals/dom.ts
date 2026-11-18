/** Emit native short-circuit selection without evaluating an inactive branch. */
import { b, findAll } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { ConditionalSelection, FunctionScoped, ReturningGuard } from '../../core/plan/model';
import type { BindingNode } from '../../core/graph';
import { declarationAssignments, patternNames } from '../../core/emit/patterns';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, numberLiteral, statement } from '../../core/emit/quote';

/** The emitted code of deferred setup statements, run once when first reached. */
export type EmitOnce = (statements: readonly Statement[]) => Statement[];

export interface SelectionContext {
  readonly names: Names;
  readonly runtime: string;
  readonly replacements: ReadonlyMap<Node, Node>;
  readonly versions: ReadonlyMap<BindingNode, string>;
  /** Deferred setup inside a component's selector program. */
  readonly once?: EmitOnce;
  readonly source?: { readonly data: string; readonly policy: Expression; readonly fallback: number };
}

export function emitSelection(selection: ConditionalSelection, context: SelectionContext) {
  const { names, runtime, replacements, versions, once } = context;
  const declarations: Statement[] = [];
  const waiting = (value: Expression): Expression => expression('({ index: $$index, value: $$data.presentSourceValue($$value, $$policy) })', {
    index: numberLiteral(context.source!.fallback),
    value,
    data: context.source!.data,
    policy: context.source!.policy,
  });
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
      if (context.source !== undefined) {
        const value = names.fresh('_sourceTest');

        return expression('$$data.selectSourceBranch($$test, ($$value) => $$value ? $$yes : $$no, $$fallback, $$policy)', {
          data: context.source.data,
          test: copy(node.test, replacements),
          value,
          yes: select(node.consequent),
          no: select(node.alternate),
          fallback: numberLiteral(context.source.fallback),
          policy: context.source.policy,
        });
      }

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
    const chosen = b.ConditionalExpression({
      test: useRight,
      consequent: select(node.right),
      alternate: choice(node.fallback, expression('$$left', { left })),
    });

    return b.SequenceExpression({
      expressions: [
        expression('$$left = $$value', { left, value: copy(node.left, replacements) }),
        context.source === undefined ? chosen : expression('$$data.selectSourceBranch($$left, () => $$chosen, $$fallback, $$policy)', {
          data: context.source.data,
          left,
          chosen,
          fallback: numberLiteral(context.source.fallback),
          policy: context.source.policy,
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
    if (context.source !== undefined) {
      for (const step of node.steps) {
        if (step.kind !== 'native') {
          continue;
        }

        for (const branch of findAll(step.statement, 'IfStatement').reverse()) {
          if (!replacements.has(branch.test)) {
            continue;
          }

          const test = names.fresh('_returnTest');
          const selected = copy(branch, local);

          selected.test = expression('$$test', { test });
          local.set(branch, b.BlockStatement({ body: [
            statement('const $$test = $$value;', { test, value: copy(branch.test, replacements) }),
            b.IfStatement({
              test: expression('$$test instanceof $$data.WaitingSourceInputs', { test, data: context.source.data }),
              consequent: b.ReturnStatement({ argument: waiting(expression('$$test', { test })) }),
              alternate: null,
            }),
            selected,
          ] }));
        }
      }
    }
    // A `var` belongs to the component's scope: declare it there, and assign
    // it where it was written. Each run of the selector is one run of the
    // authored body, so it starts with each `var` undefined again.
    const body: Statement[] = [];
    const runs = names.fresh('_selectRuns');
    declarations.push(statement('let $$runs = 0;', { runs }));
    body.push(statement('$$runs++;', { runs }));
    for (const step of node.steps) {
      if (step.kind !== 'native') continue;
      for (const guard of step.guards) {
        local.set(guard.statement, guarded(guard, runs));
      }
    }
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

  /**
   * `wiki/decisions.md`, 2026-10-24: the statement runs when it was not reached
   * on the previous run, or an input changed since it last ran. The snapshot
   * is taken after it runs, so its own writes do not make it run again. Reads
   * hidden behind an unknown call are collected while it runs, and shared
   * with the selector's own collector even on a run that skips it.
   */
  function guarded(guard: ReturningGuard, runs: string): Statement {
    const reachedAt = names.fresh('_reachedAt');
    declarations.push(statement('let $$reachedAt = -1;', { reachedAt }));
    const inputs = guard.inputs.flatMap((input) => {
      const version = versions.get(input);
      if (version === undefined) return [];
      const seen = names.fresh('_ranWith');
      declarations.push(statement('let $$seen = -1;', { seen }));
      return [{ version, seen }];
    });
    const hidden = guard.opaque ? names.fresh('_hiddenReads') : null;
    if (hidden !== null) {
      declarations.push(statement('const $$hidden = $$runtime.createComputation();', { hidden, runtime }));
    }
    const stays = [
      expression('$$reachedAt === $$runs - 1', { reachedAt, runs }),
      ...inputs.map(({ version, seen }) => expression('$$seen === $$version', { seen, version })),
      ...(hidden === null ? [] : [expression('!$$hidden.changed()', { hidden })]),
    ].reduce((left, right) => b.LogicalExpression({ operator: '&&', left, right }));
    const run = hidden === null ? [guard.statement] : [
      statement('$$hidden.begin();', { hidden }),
      guard.statement,
      statement('$$hidden.end();', { hidden }),
    ];
    return b.BlockStatement({
      body: [
        b.IfStatement({
          test: b.UnaryExpression({ operator: '!', prefix: true, argument: stays }),
          consequent: b.BlockStatement({ body: run }),
          alternate: null,
        }),
        ...(hidden === null ? [] : [statement('$$hidden.share();', { hidden })]),
        statement('$$reachedAt = $$runs;', { reachedAt, runs }),
        ...inputs.map(({ version, seen }) => statement('$$seen = $$version;', { seen, version })),
      ],
    });
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
