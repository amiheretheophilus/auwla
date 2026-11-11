# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current requested sequence

The user requested three steps in order: (1) incomplete-code recovery,
(2) bare-handler completion and auto-imports, (3) direct `for...of` inside markup.
Step 1 and its structural follow-up are built ([recovery](recovery.md)). Step 2 is done. The
task board imports `focusTaskInput` from `examples/task-board/actions.ts` and uses
it as `onClick=focusTaskInput`, and execution checks click it in both modes.
Typing `onClick=focusTask` without the import and accepting TypeScript's
completion adds the import and reproduces the authored file
(`tests/handler-import-lsp.test.ts`). That needed end anchors in
`checking/spans.ts`; see [tooling](tooling.md). Step 3 is done (spec r5,
DX-35): `for (const task of tasks) { <li key={task.id}>...</li> }` in markup
lowers to `Array.from(tasks, (task) => row)`; see
[direct loops](syntax.md#direct-loops). All three requested steps are complete.

P4-FOR-FAST is done (`9620fb57`, under DX-34). Compiler-next now gives
`Array.from(items, row)` the compiled rows that `items.map(row)` gets.
Closed-list `moved` skips still apply only to `map`.

The task board `App.auwla` is the one real example. It uses direct loops in its
template instead of `.map()`: the status buttons loop over a `filters` array,
and the task rows loop over `visible` inside the `else` branch. Both compile to
compiled row lists (`_rowList.from(...)` in the served preview bundle). Its
execution test checks the loops in both modes. The LSP completion, auto-import,
recovery and loop-binding rename tests edit it. The separate `ForLoop.auwla`
variant and the preview's `--for-loop` flag were removed at the user's request;
the task board covers everything they did.

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

Continued from the uncommitted recovery work after that review:

- Checking-only repair suggestions preserve unfinished strings, attribute
  parentheses/braces and direct-loop headers; selected missing/partial tags
  recover too. Inserted text stays unmapped and never reaches production builds.
- Review fixes: closing-tag scanning retains Unicode combining marks and astral
  letters; breadth-first search tries fewer repairs first; recovery does not drop
  an outermost unclosed opener and reinterpret its children as host statements.
- Real-server completion works inside the unfinished attribute itself, as well as
  around structural damage. Multiple repairs retain authored UTF-16/CRLF offsets.
- Spec revision 6 documents diagnostic locations for these already invalid
  inputs. No accepted syntax or event evaluation changes.

The first decoupled editor adapter is now built (DX-36):

- `packages/editor-vscode` handles activation and language/grammar registration.
  It depends on shared `./editor` metadata/mapper contribution and `./editor/grammar`
  assets in `jsx-plus`; the shared code has no editor SDK dependency.
- Its build emits a standalone TextMate grammar, language configuration and
  upstream license. Real tokenizer tests use the task board; the shared mapper
  contribution launches and transforms that same source without VS Code.
- At the user's request, TypeScript 7 (`TypeScriptTeam.native-preview` 1.0.2)
  and the local Auwla VSIX 0.0.0 are installed and listed by VS Code. Installed
  activation now resolves the mapper through open project folders, not the
  extension's installation directory. The VSIX keeps the mapper in the project.
  Desktop activation after reload, inferred-project type setup, another editor
  and a standalone mapper distribution remain unverified. See
  [adapter setup](../packages/editor-vscode/README.md).

## Evidence

At this editor checkpoint: JSX+ `bun check` reports no errors across 222 files.
JSX+ `bun test` passes **240 tests, 0 failures**, in fifteen files. They include
the 34 checking-flow targets, real TypeScript 7 CLI/LSP renames, completions,
auto-imports and recovery. The three anchor/auto-import tests fail without
`checking/spans.ts`. The previous spec baseline, unchanged here, passes 42 fixtures
(9 parse, 13 diagnostics); the JSX equivalents run in both compiler modes.
`bun check -p wiki2/spec/tsconfig.json` is clean. Task-board execution in both
compiler modes and real TS7 CLI/LSP checks pass in the package suite.
The adapter's `bun check` (6 files), `bun run build`, `node --check
dist/extension.cjs` and five simulated activation tests pass, including project
resolution from outside the checkout. VSCE packaging and CLI installation succeed.
`git diff --check` passes. No sub-agents were used.

For P4-FOR-FAST: compiler-next `bun check` is clean. All 191 `src/optimize`
tests pass, including the 7 new `mapping-calls.dom.test.ts` tests. The 398
case/unit tests in the seven files that use `Array.from` pass, and so do the
runtime's 61 list-map/row-list tests. Deliberately breaking the runtime's hole
handling, iterator check or cache density made the new tests fail. Not run: the
full root suite, performance, browser layout and IDE activation.

## Continue

1. P3-EDITOR (first adapter/assets built, DX-36): verify desktop activation with
   the compatible TypeScript provider and the real task board, then inferred
   projects and portability beyond the local VSIX. Reuse by other extensions is documented;
   a second editor still needs its own integration evidence.
   See [tooling](tooling.md#editor-extension-planned-p3-editor).
2. Loop follow-up in compiler-next (DX-34): extend the closed-list proof to
   `Array.from(root, row)` so unchanged rows are skipped (`moved`). Log it in
   the table below.

Done since: edits through destructured names (`entries()` loops) are shown
(`4072c829`). Compiler-next `src` unit tests (616) and the seven
handler/list case files (235) pass. The slow reference/generator suites
were not run locally. Damaged markup beside an ordinary host syntax error no
longer hides the file's diagnostics ([recovery](recovery.md)); a real-server
case shows both errors with completion still available.

Known open issues:
- Recovery remains heuristic and bounded to three repairs and 24 rereads.
  Completion inside quarantined text and broader combinations of multiline
  damage remain open. Same-line host declarations now survive when an inserted
  closer repairs the markup; unsafe host-code removal still falls back.
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
| `9620fb57` | New `optimize/mapping-calls.ts` ([optimize](../wiki/compiler/optimize.md#row-lists)). Row reuse and row lists accept the intrinsic `Array.from(items, row)`, with `rowReuse.form` added to the plan model. The runtime gains `fromRows`, `RowList.from`, `iteratedItems` and a `dense` cache mode. Closed lists stay `map`-only | Direct loops lower to `Array.from`; without this they never get compiled rows |
| `4072c829` | `features/handlers/plan.ts`: `aliasBindings` judges a destructured name by the declaration or parameter owning its pattern (`patternRoot`), with `features/handlers/aliases.test.ts` ([handlers](../wiki/compiler/handlers.md)) | `for (const [index, task] of tasks.entries())` row edits were not shown; a genuine bug, plain JSX too |

Check this list with `git log compiler-rewrite..prototype/jsx-plus -- packages/compiler-next packages/runtime`.

See [plan](plan.md), [tooling](tooling.md) and [rewrite acceptance](../wiki/status.md).
