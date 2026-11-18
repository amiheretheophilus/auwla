/**
 * Body statements that run again when what they read changes (`wiki/decisions.md`, 2026-11-15;
 * `wiki/compiler/state-and-derived.md`, "Body statements that build nothing").
 *
 * A component's body statement that builds a value is a step of that value's derivation
 * (`plan.ts`). Every other top-level statement used to run once, as setup. Now it runs again,
 * side effects included, whenever a value it read changed since it last ran:
 *
 *   if (count > 10) { console.log(count); navigate('/'); }   // runs again when count changes
 *   setInterval(() => seconds--, 1000);                      // reads seconds only later: runs once
 *
 * Its own writes are not its inputs, so it cannot run itself again, and two statements writing one
 * list cannot run each other forever: the computation around it drops what it wrote
 * (`runtime/src/computation.ts`, `end`). A statement that may build a value (`record(count)`) is
 * watched too, while it has not been seen to build: once it has, the value's group replays it.
 */
import { findAll, is, walk } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../../core/graph';
import type { InputQueries } from '../../core/graph/inputs';
import { declaringRunner, type Module } from '../../core/resolve';
import { lifecycleKind } from '../../core/resolve/ambient';
import type { MemoGroupPlan, WatchedStatement } from '../../core/plan/model';

/** Statement kinds that run as one unit in a guard, without changing their scoping. */
const WATCHABLE = new Set([
  'ExpressionStatement', 'IfStatement', 'SwitchStatement', 'BlockStatement',
  'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement',
]);

export interface WatchedContext {
  readonly fn: Node;
  readonly setup: readonly Statement[];
  readonly deferred: ReadonlyMap<Statement, number>;
  readonly memos: readonly MemoGroupPlan[];
  /** Whether the statement registers an effect or cleanup, also through a helper (`features/effects`). */
  readonly registersLifecycle: (statement: Statement) => boolean;
}

export function planWatched(context: WatchedContext, module: Module, graph: SemanticGraph, queries: InputQueries): WatchedStatement[] {
  const { fn, setup, deferred, memos } = context;
  // The component's own bindings, whose definite writes in a statement make it a builder.
  const own = [...graph.bindings.values()].filter((node) => node.binding.module === module && declaringRunner(module, node.binding) === fn);
  const watched: WatchedStatement[] = [];
  for (const statement of setup) {
    // A statement after the component's first return runs inside its selector (`returns.ts`).
    if (deferred.has(statement) || !WATCHABLE.has(statement.type) || !replayable(module, statement)) continue;
    // Registering an effect or cleanup is the component's setup, and runs once.
    if (context.registersLifecycle(statement)) continue;

    const outputs = memos.flatMap((group) => {
      const all = group.outputs.get(statement) ?? [];
      const possible = group.possibleOutputs.get(statement) ?? [];
      return all.map((target) => ({ target, definite: !possible.includes(target) }));
    });
    // A statement that builds a value runs again when that value is computed again.
    if (outputs.some((output) => output.definite)) continue;

    const facts = queries.inputsOf(module, statement);
    // A definite write to one of the component's own bindings builds it (`run.calls = 0` builds
    // `run`), even where that binding has no derivation of its own to replay it.
    const definite = (site: { kind: string; node: Node; runner: Node | null }) => {
      return site.kind !== 'call' && site.kind !== 'argument' && site.runner === fn
        && site.node.start >= statement.start && site.node.end <= statement.end;
    };
    const buildsLocal = facts.writes.some((site) => definite(site) && declaringRunner(module, site.binding) === fn)
      || own.some((node) => node.writes.some(({ site }) => definite(site)));
    if (buildsLocal) continue;
    const inputs = new Set<BindingNode>();
    for (const read of facts.reads) {
      const binding = read.binding ?? read.reference.binding;
      const node = binding === null ? undefined : graph.bindings.get(binding);
      // Only a value that can change makes a statement run again.
      if (node !== undefined && changes(node)) inputs.add(node);
    }
    if (inputs.size === 0 && !facts.opaque) continue;
    watched.push({ statement, inputs: [...inputs], opaque: facts.opaque, possible: outputs.length > 0 });
  }
  return watched;
}

function changes(node: BindingNode): boolean {
  return node.writes.length > 0 || node.kind === 'Derived' || node.kind === 'Source' || node.kind === 'Opaque';
}

/**
 * Whether the statement can run again on its own: not one that suspends (`await`, `yield`), and
 * not one that registers a lifecycle callback (`$effect`, `$cleanup`), which belongs to the
 * component's setup alone (`features/effects`).
 */
function replayable(module: Module, statement: Statement): boolean {
  let result = true;
  walk(statement, {
    enter(node: Node, context) {
      if (is.Function(node)) {
        context.skip();
      } else if (is.AwaitExpression(node) || is.YieldExpression(node)) {
        result = false;
        context.stop();
      }
    },
  });
  if (!result) return false;
  if (findAll(statement, 'CallExpression').some((call) => lifecycleKind(module, call) !== null)) return false;
  return !capturesOwnBinding(module, statement);
}

/**
 * Whether a function created inside the statement captures a binding the statement declares:
 * `{ let count = 1; read = () => count; }`. Running it again would make new bindings while the
 * functions it made before keep the old ones, so such a block keeps its own derivation instead.
 */
function capturesOwnBinding(module: Module, statement: Statement): boolean {
  const functions = findAll(statement, ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
  if (functions.length === 0) return false;
  const inside = (node: Node, outer: Node) => node.start >= outer.start && node.end <= outer.end;
  return module.bindings.some((binding) => {
    const declaration = binding.declarations[0];
    if (declaration === undefined || !inside(declaration, statement)) return false;
    // A binding of a nested function belongs to that function's own runs.
    const owners = functions.filter((fn) => inside(declaration, fn));
    return binding.references.some((reference) => functions.some((fn) => {
      return inside(reference.node, fn) && !owners.includes(fn);
    }));
  });
}
