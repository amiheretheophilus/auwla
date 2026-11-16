/**
 * `$snapshot(value)`: a value taken once (`wiki/compiler/state-and-derived.md`, "Snapshots").
 *
 * A binding whose initializer reads something reactive is derived: it follows what it reads. A
 * write in the component body is part of that derivation too, so plain JavaScript has no way to
 * say "keep the value this had at the start", as an undo or a "changed since opened" check needs:
 *
 *   const saved = $snapshot(state.user);   // keeps this object; `state.user` may change later
 *
 * The analysis does not count what the argument reads (`InputQueries.inputsOf`,
 * `summarizeFunctions`), so the binding is a constant, or state once something writes it: the
 * table's "nothing reactive" rows. The output evaluates the argument once, untracked
 * (`emitSnapshots`), so no computation running the setup subscribes to it either.
 *
 * `$snapshot` is a marker like `$effect`: only a declaration's initializer may call it, with one
 * value. A module that declares or assigns its own `$snapshot` has an ordinary function.
 */
import { b, is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import { CompileError } from '../../core/diagnostics';
import type { Module, Resolved } from '../../core/resolve';
import { snapshotCalls } from '../../core/resolve/ambient';
import { expression } from '../../core/emit/quote';

const NAME = '$snapshot';

type CallNode = Extract<Node, { type: 'CallExpression' }>;

/**
 * Throws a `CompileError` at the first `$snapshot` used other than as a declaration's initializer
 * with one value: `$snapshot` as a value, two arguments, a spread, or a call inside an expression
 * (`f($snapshot(x))`), where taking a value once has no binding to keep it in.
 */
export function checkSnapshots(resolved: Resolved): void {
  for (const entry of resolved.modules) {
    const module = entry.module;
    const references = module.unresolvedReferences.filter((reference) => !reference.inTypePosition && reference.name === NAME);
    if (references.length === 0 || references.some((reference) => reference.isWrite)) continue;

    const fail = (message: string, at: number): never => {
      throw CompileError.at(message, entry.path, module.source, at);
    };
    for (const reference of references) {
      const call = module.parentOf(reference.node);
      if (call === null || !is.CallExpression(call) || call.callee !== reference.node) {
        fail('`$snapshot` must be called directly, as `const saved = $snapshot(value)`: the compiler replaces that call, and there is no `$snapshot` value at run time.', reference.node.start);
      }
      const snapshot = call as CallNode;
      if (snapshot.arguments.length !== 1 || is.SpreadElement(snapshot.arguments[0]!)) {
        fail('`$snapshot` takes exactly one value: `const saved = $snapshot(value)`.', snapshot.start);
      }
      const declarator = module.parentOf(snapshot);
      if (declarator === null || !is.VariableDeclarator(declarator) || declarator.init !== snapshot) {
        fail('`$snapshot(value)` must be the whole initializer of a declaration, as in `const saved = $snapshot(value)`: the value it takes once is kept in that binding.', snapshot.start);
      }
    }
  }
}

/** Each snapshot call becomes `runtime.untracked(() => value)`, evaluated once where it stands. */
export function emitSnapshots(module: Module, runtime: string, replacements: Map<Node, Node>): void {
  for (const call of snapshotCalls(module)) {
    const value = call.arguments[0] as Expression;
    const read = b.ArrowFunctionExpression({ id: null, params: [], async: false, generator: false, expression: true, body: value });
    replacements.set(call, expression('$$runtime.untracked($$read)', { runtime, read }));
  }
}
