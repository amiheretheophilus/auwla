# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current requested sequence

The user requested three steps in order: (1) incomplete-code recovery,
(2) bare-handler completion and auto-imports, (3) direct `for...of` inside markup.
Step 1's first profile is built ([recovery](recovery.md)). Step 2 has started: the
task board imports `focusTaskInput` from `examples/task-board/actions.ts` and uses
it as `onClick=focusTaskInput`; execution checks click it in both modes. The
native completion/auto-import LSP check for that handler is **not written yet**.
Step 3 has not started.

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

At the latest commit: JSX+ `bun check` reports no errors across 214 files.
JSX+ `bun test` passes **185 tests, 0 failures**, in twelve files. They include the
34 checking-flow targets, real TypeScript 7 CLI/LSP renames, completions and recovery.
`bun run wiki2/spec/check.ts` passes 34 fixtures (8 diagnostics). The
`preview.ts --build` task-board build succeeds. `git diff --check` passes. No
sub-agents were used. Compiler-next and runtime sources are unchanged in this
session. Not run: the full root suite, performance, browser layout and IDE activation.

## Continue

1. P3-HANDLER-IMPORT: add the native LSP check for `onClick=focus|`. It should
   offer `focusTaskInput` from `./actions`, apply the auto-import edit to authored
   text and recheck clean. Record whether TS places the import edit correctly.
2. P4-DIRECT-FOR: draft the grammar and fixtures first, then implement and run
   real application/ownership checks.

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
