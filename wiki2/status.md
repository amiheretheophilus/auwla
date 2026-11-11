# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current requested sequence

The user requested three steps in order: (1) incomplete-code recovery,
(2) bare-handler completion and auto-imports, (3) direct `for...of` inside markup.
Step 1's first profile is built ([recovery](recovery.md)). Step 2 is done. The
task board imports `focusTaskInput` from `examples/task-board/actions.ts` and uses
it as `onClick=focusTaskInput`, and execution checks click it in both modes.
Typing `onClick=focusTask` without the import and accepting TypeScript's
completion adds the import and reproduces the authored file
(`tests/handler-import-lsp.test.ts`). That needed end anchors in
`checking/spans.ts`; see [tooling](tooling.md). Step 3 is done (spec r5,
DX-35): `for (const task of tasks) { <li key={task.id}>...</li> }` in markup
lowers to `Array.from(tasks, (task) => row)`. `ForLoop.auwla` uses it; see
[direct loops](syntax.md#direct-loops). All three requested steps are complete.

## This session: review and cleanup

The user asked for the previous agent's work to be reviewed for correctness,
duplication and readability before new features. Done, in separate commits:

- Fixed: the task-board editor tests opened the task board under
  `examples/checking`'s file URI and project (`taskBoardRoot` now).
- Shared helpers: `masks.ts` (every parser-only mask), token helpers in
  `host.ts`, `authoredCover`/`nearestAuthoredOffset` in `source.ts`. Attribute
  readers return an `AttributeValue` that carries its own mask.
- `normalize.ts` split into `markup/context.ts`, `markup/element.ts` and
  `markup/children.ts`. An unreachable uncached-block fallback now reports
  an `INTERNAL` diagnostic instead of misreading children.
- Fixes: compiler errors on generated text no longer leak normalized-TSX
  positions; editor messages drop the duplicated `(file:line:col)`; the mapper
  `initialize` handler no longer crashes on missing encodings; flow insertion
  order is an explicit, tested rule.
- Tests: one `tests/lsp.ts` session helper replaces repeated LSP plumbing.
- Spec revision 4 (diagnostics only): JPX1009 for undelimited non-identifier
  attribute values; JPX1005 for a top-level child comma. See the
  [changelog](spec/CHANGELOG.md).

## Evidence

At the latest commit: JSX+ `bun check` reports no errors across 217 files.
JSX+ `bun test` passes **215 tests, 0 failures**, in fourteen files. They include
the 34 checking-flow targets, real TypeScript 7 CLI/LSP renames, completions,
auto-imports and recovery. The three anchor/auto-import tests fail without
`checking/spans.ts`. `bun run wiki2/spec/check.ts` passes 39 fixtures
(9 parse, 10 diagnostics); the loops' `Array.from` JSX equivalents run in both
compiler modes. Both `preview.ts --build` variants succeed, and the task-board
tsconfig type-checks through the TS7 CLI with the mapper. `git diff --check` passes. No
sub-agents were used. Compiler-next and runtime sources are unchanged in this
session. Not run: the full root suite, performance, browser layout and IDE activation.

## Continue

1. P4-FOR-FAST (DX-34/35): teach compiler-next's compiled-row path
   (`optimize/methods.ts`, `optimize/closed-lists.ts`, `optimize/row-lists.ts`)
   to accept `Array.from(x, cb)` like `x.map(cb)`. Evidence target:
   `createRowList` appears for a direct loop. Consider row-write tracking through
   `entries()`/`values()` too. Log changes in the reconcile table below.
2. P3-EDITOR (candidate): a thin VS Code extension for language registration,
   highlighting and mapper registration via TS7's `registerContentMappers`.
   See [tooling](tooling.md#editor-extension-planned-p3-editor).

Known open issues:
- If markup damage occurs alongside an ordinary host syntax error anywhere,
  recovery falls back to an empty module, hiding all other diagnostics.
- Recovery inside quarantined text and multiline structural damage are open.
- Replay proofs, lowering maps, module loading, Vite/HMR, delivery and
  debugging maps remain open. Backend configuration stays planned.

## Compiler-next changes to reconcile

Compiler-next is unfinished (branch `compiler-rewrite`) and is continued
separately. Under DX-34 this branch may change it for `.auwla` interop. Each
change below must be adopted or corrected on `compiler-rewrite` later:

| Commit | Change | Why `.auwla` needs it |
| --- | --- | --- |
| `1d3ef3bf` | New read-only analysis API in `packages/compiler-next/src/analysis/`; `pipeline.ts` shares its frontend; `./analysis` package export ([compiler analysis](../wiki/compiler/analysis.md)) | The checking flow planner reads binding/dependency facts without DOM emission |
| `dbe46803` | `analysis/index.ts` re-exports `CompileError` | The planner skips modules the compiler rejects |
| `a35db526` | `analysis/serialize.ts` also describes JSX spread arguments (`{...props}`) as expressions | Spread inputs get flow checking like expression containers |
| `b05773b5` | `runtime/src/setters.ts`: uncached ARIA `false`/`true` follow the cached/spread rules, with a DOM test | Found by the task-board example; a runtime bug fix, not interop |

Check this list with `git log compiler-rewrite..prototype/jsx-plus -- packages/compiler-next packages/runtime`.

See [plan](plan.md), [tooling](tooling.md) and [rewrite acceptance](../wiki/status.md).
