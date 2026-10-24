/** Native lazy selectors, with independently retained branch templates. */
import { is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import type { ConditionalBranch, ConditionalSelection, ProgramStep, Site, Template } from '../../core/plan/model';
import { unwrap } from '../../core/plan/jsx';

export function canPlanConditional(expression: Expression, hasMarkup: (node: Node) => boolean): boolean {
  const node = unwrap(expression);
  if (is.JSXElement(node) || is.JSXFragment(node)) {
    return true;
  }
  if (is.ConditionalExpression(node)) {
    return canPlanConditional(node.consequent, hasMarkup)
      && canPlanConditional(node.alternate, hasMarkup);
  }
  if (is.LogicalExpression(node)) {
    return !hasMarkup(node.left) && canPlanConditional(node.right, hasMarkup);
  }
  return !hasMarkup(node);
}

export interface ConditionalContext {
  hasMarkup(node: Node): boolean;
  template(node: Extract<Node, { type: 'JSXElement' | 'JSXFragment' }>): { template: Template; sites: Site[] };
  unsupported(node: Node): never;
}

export function planConditional(expression: Expression, context: ConditionalContext) {
  const planner = new SelectionPlanner(context);
  const selection = planner.select(expression);
  return { selection, branches: planner.branches, selectorInputs: planner.selectorInputs };
}

/** A component tail as it runs: setup segments, native statements, and returns. */
export interface ReturnTail {
  readonly steps: readonly ProgramStep[];
  /** Each component `return`, with whether its markup reads a variable declared in the tail's own blocks. */
  readonly returns: readonly { readonly node: Extract<Node, { type: 'ReturnStatement' }>; readonly readsBlockLocal: boolean }[];
  /** What a native statement computes before it returns, apart from return arguments. */
  readonly inputs: readonly Expression[];
}

export function planReturnProgram(tail: ReturnTail, context: ConditionalContext) {
  const planner = new SelectionPlanner(context);
  const returns = new Map<Node, ConditionalSelection>();
  for (const { node, readsBlockLocal } of tail.returns) {
    const argument = node.argument ?? null;
    // A template branch is created outside the selector, where a variable of
    // the tail's own blocks is not in scope. Such markup becomes a captured
    // value, evaluated where it is written.
    if (argument === null || readsBlockLocal || !canPlanConditional(argument, context.hasMarkup)) {
      returns.set(node, planner.value(argument));
    } else {
      returns.set(node, planner.select(argument));
    }
  }
  planner.selectorInputs.push(...tail.inputs);
  // Control can reach the end of the body unless its last statement returns.
  const last = tail.steps.at(-1);
  const endsInReturn = last?.kind === 'native' && is.ReturnStatement(last.statement);
  const selection: ConditionalSelection = {
    kind: 'program',
    steps: tail.steps,
    returns,
    fallthrough: endsInReturn ? null : planner.primitiveBranch(),
  };
  return { selection, branches: planner.branches, selectorInputs: planner.selectorInputs };
}

class SelectionPlanner {
  readonly branches: ConditionalBranch[] = [];
  readonly selectorInputs: Expression[] = [];
  // A fallthrough return can reach the same authored JSX along several paths.
  // It must retain one branch identity rather than remounting on a path change.
  private readonly markupBranches = new Map<Node, number>();

  constructor(private readonly context: ConditionalContext) {}

  primitiveBranch(): number {
    const index = this.branches.length;
    this.branches.push({ template: null, sites: [] });
    return index;
  }

  /** A branch that shows a value as it is, markup included. */
  value(expression: Expression | null): ConditionalSelection {
    if (expression !== null) this.selectorInputs.push(expression);
    return { kind: 'branch', index: this.primitiveBranch(), value: expression };
  }

  select(original: Expression): ConditionalSelection {
    const node = unwrap(original);
    if (is.JSXElement(node) || is.JSXFragment(node)) {
      const existing = this.markupBranches.get(node);
      if (existing !== undefined) {
        return { kind: 'branch', index: existing, value: null };
      }
      const index = this.branches.length;
      this.markupBranches.set(node, index);
      this.branches.push(this.context.template(node));
      return { kind: 'branch', index, value: null };
    }
    if (is.ConditionalExpression(node)) {
      this.selectorInputs.push(node.test);
      return {
        kind: 'test',
        test: node.test,
        consequent: this.select(node.consequent),
        alternate: this.select(node.alternate),
      };
    }
    if (is.LogicalExpression(node) && !this.context.hasMarkup(node.left)) {
      this.selectorInputs.push(node.left);
      return {
        kind: 'logical',
        operator: node.operator,
        left: node.left,
        right: this.select(node.right),
        fallback: this.primitiveBranch(),
      };
    }
    if (this.context.hasMarkup(node)) {
      return this.context.unsupported(node);
    }
    return this.value(original);
  }
}
