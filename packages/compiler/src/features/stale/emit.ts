/**
 * Stale checks in a dev server's browser build (`wiki/compiler/stale.md`).
 *
 * Each component registers its plain derived values with the runtime (`runtime/src/stale.ts`):
 * how to read one, and its initializer to compute it again, rewritten as its replay is. The
 * runtime computes them again after updates and reports a value that no longer matches: an edit
 * the compiler could not see left it out of date.
 *
 * Computing again must be safe and must agree with the value whenever nothing went wrong. So only
 * a value that is computed from its initializer alone is registered, and not one that is
 * changed or edited after it is made, written by its initializer's side effects, or read from a
 * ref (the page changes a ref's measurements without telling anyone).
 */
import { b, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { ComponentPlan, MemoGroupPlan, MemoPlan } from '../../core/plan/model';
import { copy } from '../../core/emit/copy';
import { expression, statement, stringLiteral } from '../../core/emit/quote';

/**
 * `_MD.watchStale(_entity, "./App.tsx#App", [{ name, inputs, read, compute }, …])`, or null when
 * the component has no value to check.
 */
export function emitStaleChecks(
  plan: ComponentPlan,
  replacements: ReadonlyMap<Node, Node>,
  runtime: string,
  entity: string,
  component: string,
): Statement | null {
  const checks = plan.memos.flatMap((group) => group.computations.filter((memo) => checkable(plan, group, memo)));
  if (checks.length === 0) {
    return null;
  }
  const entries = checks.map((memo) => {
    const name = memo.targets[0]!.binding.name;
    const inputs = [...new Set(memo.inputs.map((input) => input.binding.name))];
    return expression('({ name: $$name, inputs: $$inputs, read: () => $$binding, compute: () => ($$value) })', {
      name: stringLiteral(name),
      inputs: b.ArrayExpression({ elements: inputs.map(stringLiteral) }),
      binding: name,
      value: copy(memo.declarator.init!, replacements),
    });
  });
  return statement('$$runtime.watchStale($$entity, $$component, $$checks);', {
    runtime, entity, component: stringLiteral(component), checks: b.ArrayExpression({ elements: entries }),
  });
}

function checkable(plan: ComponentPlan, group: MemoGroupPlan, memo: MemoPlan): boolean {
  if (memo.nested || memo.targets.length !== 1 || !is.Identifier(memo.declarator.id) || memo.declarator.init === null) {
    return false;
  }
  const target = memo.targets[0]!;
  // Built by later statements too, or sharing a step with another value: the initializer alone
  // does not give its value.
  if (target.kind !== 'Derived' || group.steps.length !== 1 || memo.builders.length > 0 || memo.possibleBuilders.size > 0) {
    return false;
  }
  // Reassigned or edited after it is made: it holds what that left, by design.
  if (target.writes.length > 0 || target.takeovers.length > 0 || plan.takeovers.includes(target)) {
    return false;
  }
  if (memo.inputs.some((input) => input.kind === 'Ref')) {
    return false;
  }
  const module = target.binding.module;
  // Declared in the component's own body, so the registration after it can name it, and run as
  // setup, not only once control reaches it after an early return.
  if (module.parentOf(memo.declaration) !== plan.fn.body || plan.deferred.has(memo.declaration)) {
    return false;
  }
  const init = memo.declarator.init;
  // Computing again would repeat a write (`count++`, `seen.push(name)`).
  const writes = [...plan.replayWrites, ...plan.replayMutations.filter((mutation) => mutation.method?.kind !== 'read')];
  if (writes.some(({ operation }) => operation.start >= init.start && operation.end <= init.end)) {
    return false;
  }
  // A field that reads nothing is computed once (`{ id: nextId++ }`), and computing it again
  // could do what it did a second time.
  if (memo.fields?.some((field) => field.inputs.length === 0 && !field.unseen && !inert(field.value)) === true) {
    return false;
  }
  return true;
}

/** A value that does nothing when computed: a name, a literal, a function. */
function inert(node: Node): boolean {
  return is.Identifier(node) || is.Literal(node) || is.Function(node);
}
