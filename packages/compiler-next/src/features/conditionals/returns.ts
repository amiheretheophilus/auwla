/**
 * A component body's returns, as a plan for its selector; never edits authored
 * syntax (`conditionals-and-lists.md`, "Early returns").
 */
import { b, is, walk } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { FunctionScoped, ProgramStep } from '../../core/plan/model';
import type { ReturnTail } from './plan';

type ReturnNode = Extract<Node, { type: 'ReturnStatement' }>;

export function hasReturn(root: Node): boolean {
  return componentReturns(root).length > 0;
}

/** The returns that end the component, not those of a nested function. */
function componentReturns(root: Node): ReturnNode[] {
  const found: ReturnNode[] = [];
  walk(root, {
    enter(node, context) {
      if (is.Function(node)) {
        context.skip();
      } else if (is.ReturnStatement(node)) {
        found.push(node);
      }
    },
  });
  return found;
}

export type ReturnsPlan =
  /** Only `if`/`else` and returns after setup: one selector expression. */
  | { readonly kind: 'expression'; readonly setup: Statement[]; readonly expression: Expression }
  /** Setup between returns, or returns in a `switch` or a loop. */
  | {
    readonly kind: 'program';
    readonly setup: Statement[];
    readonly deferred: ReadonlyMap<Statement, number>;
    readonly tail: ReturnTail;
  };

/**
 * `readsBlockLocal(markup, block)` tells whether a returned expression reads a
 * variable declared inside `block` but outside the expression itself.
 * `selectsMarkup(expression)` tells whether a folded expression plans as a
 * markup selection. One that does not is still a program: a folded expression
 * is new syntax with no authored position, so its inputs could not be found.
 */
export function planReturns(
  body: readonly Statement[],
  readsBlockLocal: (markup: Expression, block: Statement) => boolean,
  selectsMarkup: (expression: Expression) => boolean,
): ReturnsPlan {
  const first = body.findIndex(hasReturn);
  const setup = first < 0 ? [...body] : body.slice(0, first);
  const tail = first < 0 ? [] : body.slice(first);
  if (tail.every(isReturnOnly)) {
    const expression = fold(tail, empty());
    if (expression.end > 0 || selectsMarkup(expression)) {
      return { kind: 'expression', setup, expression };
    }
  }

  // As the reference runs a body: a top-level statement without a return is
  // setup and runs once, the first time control reaches it. A statement that
  // returns runs as written each time the component selects what to show.
  const steps: ProgramStep[] = [];
  const deferred = new Map<Statement, number>();
  const returns: ReturnTail['returns'][number][] = [];
  const inputs: Expression[] = [];
  const functionScoped: FunctionScoped[] = [];
  let segment: Statement[] | null = null;
  let segments = 0;
  for (const statement of tail) {
    if (!hasReturn(statement)) {
      if (segment === null) {
        segment = [];
        steps.push({ kind: 'once', statements: segment });
        segments++;
      }
      segment.push(statement);
      deferred.set(statement, segments - 1);
      continue;
    }
    segment = null;
    steps.push({ kind: 'native', statement });
    for (const node of componentReturns(statement)) {
      const argument = node.argument ?? null;
      returns.push({ node, readsBlockLocal: argument !== null && readsBlockLocal(argument, statement) });
    }
    inputs.push(...statementInputs(statement));
    functionScoped.push(...varDeclarations(statement));
  }
  return {
    kind: 'program',
    setup: [...setup, ...deferred.keys()],
    deferred,
    tail: { steps, returns, inputs, functionScoped },
  };
}

type VarDeclaration = Extract<Node, { type: 'VariableDeclaration' }>;

/** `var` declarations of the component itself, not of a nested function, with where each sits. */
function varDeclarations(root: Node): FunctionScoped[] {
  const heads = new Map<Node, FunctionScoped['position']>();
  const found: FunctionScoped[] = [];
  walk(root, {
    enter(node, context) {
      if (is.Function(node)) {
        context.skip();
        return;
      }
      if (is.ForStatement(node) && node.init !== null) heads.set(node.init, 'for-init');
      if (is.ForInStatement(node) || is.ForOfStatement(node)) heads.set(node.left, 'for-left');
      if (is.VariableDeclaration(node) && node.kind === 'var') {
        found.push({ declaration: node as VarDeclaration, position: heads.get(node) ?? 'statement' });
      }
    },
  });
  return found;
}

/** Return-only control flow: `if`/`else`, blocks and returns. */
function isReturnOnly(statement: Statement): boolean {
  if (is.ReturnStatement(statement) || is.EmptyStatement(statement)) {
    return true;
  }
  if (is.BlockStatement(statement)) {
    return statement.body.every((entry) => isReturnOnly(entry as Statement));
  }
  if (is.IfStatement(statement)) {
    return isReturnOnly(statement.consequent as Statement)
      && (statement.alternate === null || isReturnOnly(statement.alternate as Statement));
  }
  return false;
}

function empty(): Expression {
  return b.UnaryExpression({ operator: 'void', prefix: true, argument: b.Literal({ value: 0, raw: '0' }) });
}

/** Fold return-only control flow into one conditional expression. */
function fold(statements: readonly Statement[], fallback: Expression): Expression {
  const [statement, ...rest] = statements;
  if (statement === undefined) {
    return fallback;
  }
  if (is.ReturnStatement(statement)) {
    return statement.argument ?? empty();
  }

  // A path without a return continues with the rest of the enclosing body.
  const continuation = fold(rest, fallback);
  if (is.EmptyStatement(statement)) {
    return continuation;
  }
  if (is.BlockStatement(statement)) {
    return fold(statement.body as Statement[], continuation);
  }
  const test = statement as Extract<Statement, { type: 'IfStatement' }>;
  return b.ConditionalExpression({
    test: test.test,
    consequent: fold([test.consequent as Statement], continuation),
    alternate: test.alternate === null
      ? continuation
      : fold([test.alternate as Statement], continuation),
  });
}

/** Nodes a walk enters for their own expressions; everything else is an expression. */
const STRUCTURE = new Set(['SwitchCase', 'VariableDeclaration', 'VariableDeclarator', 'CatchClause', 'BlockStatement']);
/** Fields that name or declare, rather than compute. */
const NAMES = new Set(['id', 'label', 'param', 'left']);

/**
 * The expressions a statement evaluates on its way to a return: tests,
 * discriminants, loop headers and plain statements. Return arguments are left
 * out; their selections record their own inputs.
 */
function statementInputs(root: Statement): Expression[] {
  const inputs: Expression[] = [];
  walk(root, {
    enter(node, context) {
      if (is.Function(node) || is.ReturnStatement(node)) {
        context.skip();
        return;
      }
      if (!is.Statement(node) && !STRUCTURE.has(node.type)) {
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        for (const child of Array.isArray(value) ? value : [value]) {
          if (!isNode(child) || is.Statement(child) || STRUCTURE.has(child.type)) continue;
          // `for (x of xs)` assigns `x`; it is not read.
          if (NAMES.has(key)) continue;
          inputs.push(child as Expression);
        }
      }
    },
  });
  return inputs;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
