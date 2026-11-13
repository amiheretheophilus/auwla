# Prototype status

Updated: 2026-11-13. Branch: `prototype/jsx-plus`.

## Compiler baseline synchronization

This branch integrates `compiler-rewrite` through `07e996c9` (2026-11-13).
The local and remote compiler tips matched when fetched. The user authorized
committing and pushing the synchronization while excluding their live
`App.auwla` edits. `compiler-rewrite` itself is unchanged.

Two merge conflicts were resolved in `analysis/frontend.ts` and `pipeline.ts`
using the latest compiler implementation. The compiler, runtime, data, router,
server and Vite directories match that compiler tip exactly. This retains route
lowering/splitting, source maps, component hot replacement, project/application
builds, server functions and the compiler-next Vite adapter. The existing JSX+
syntax and checking package remain separate; the CSS proposal is still a design.

The previously listed compiler/runtime changes from this branch were already
adopted on `compiler-rewrite` in `bd237a29`. The reconciliation table below is now
a historical record, not outstanding adoption work. Further interop changes must
still be recorded there under DX-34.

The branch switch exposed LF-only fixture searches against CRLF example files.
Three JSX+ test files now match the authored line endings when removing imports
or damaging multiline markup. Auto-import assertions still check TypeScript's
exact generated LF edit and preserve every other authored line ending. No
production parser or compiler behavior changed for this correction.

Integration checks: compiler-next `bun check` is clean (269 files); JSX+
`bun check` is clean (255 files); the editor adapter check is clean (6 files)
and its 7 activation tests pass. The 83 focused compiler tests for analysis,
source maps, routes, lazy route splits and hot replacement pass. The 46-fixture
spec baseline also passes; extended execution is covered separately by the
package tests, not claimed by that baseline runner.

The initial JSX+ run passed 263 tests and exposed the five LF-only fixture
failures. All 23 tests in the three corrected files then passed across focused
runs. The final full run passed 266 tests with two failures: during verification,
the live `examples/checking/App.auwla` acquired an unfinished `if(name.)` edit.
Those two tests expect a clean baseline example. That user draft is preserved
and unstaged; the run is not reported as fully green. The root suite, browser
acceptance and performance checks were not run. The staged whitespace check
also reports an existing extra EOF blank line in the incoming
`features/slots/lower.ts`; the compiler tree is retained exactly as received.

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
`Array.from(items, row)` the compiled rows that `items.map(row)` gets. The
closed-list unchanged-row skip now goes through the same path too: the proof,
planner and emitter ask `mappingCall` for the list a row list iterates instead
of special-casing `.map`. A loop over a plain state list skips unchanged rows
exactly as `.map` does. The task board's lists are derived (`visible`) or
module data (`filters`), so neither spelling skips there. One-line DOM event
handlers that return the list (`onClick=(() => rows.reverse())`) no longer turn
the skip off; component props still do.

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
  and the local Auwla VSIX 0.0.2 are installed and listed by VS Code. Installed
  activation now resolves the mapper through open project folders, not the
  extension's installation directory. The VSIX keeps the mapper in the project.
  After the quoted-interpolation update, the user opened the task board
  `App.auwla` in desktop VS Code with the installed extension and reported that
  it works, with autocompletion including the quoted `{remaining}` (2026-11-11). Inferred-project type setup, another editor and a
  standalone mapper distribution remain unverified. See
  [adapter setup](../packages/editor-vscode/README.md).

Live editor follow-up: the provider initially ran bundled TypeScript 7.0.2, which
rejected mapper contribution registration. The user selected the workspace
7.1.0-beta SDK; the running process now uses that executable. Adapter 0.0.1 reports
the selected SDK and offers the native version picker for unsupported servers.
The counter project enables existing element types once through `./types`, with
`jsx: "preserve"`, so it needs no per-file type import. The real server test now
checks its clean baseline, authored error and hover after editor registration.

DX-37 is built in spec revision 7: `<p>"Count: {count}"</p>` becomes a native
template, with host-token substitution boundaries and exact authored mappings.
The counter uses it. Native LSP tests complete, hover and rename inside the quotes,
including completion in empty or unfinished expressions. Shared highlighting marks
the expression as code. Auwla 0.0.2 packages those assets and is installed; reload
VS Code to replace the old grammar and mapper process. See [syntax](syntax.md).

## Evidence

At this interpolation checkpoint: JSX+ `bun check` reports no errors across 228 files.
JSX+ `bun test` passes **266 tests, 0 failures**, in eighteen files. They include
the 34 checking-flow targets, real TypeScript 7 CLI/LSP renames, completions,
auto-imports and recovery. The three anchor/auto-import tests fail without
`checking/spans.ts`. The spec baseline passes 46 fixtures
(10 parse, 15 diagnostics); the JSX equivalents run in both compiler modes.
`bun check -p wiki2/spec/tsconfig.json` is clean. Task-board execution in both
compiler modes and real TS7 CLI/LSP checks pass in the package suite.
The adapter's `bun check` (6 files), `bun run build`, `node --check
dist/extension.cjs` and seven simulated activation tests pass, including project
resolution from outside the checkout. VSCE packaging and CLI installation succeed.
The counter project's TS7 CLI check also passes without a per-file type import.
The slice's staged whitespace check passes. No sub-agents were used.

For P4-FOR-FAST: compiler-next `bun check` is clean. All 191 `src/optimize`
tests pass, including the 7 new `mapping-calls.dom.test.ts` tests. The 398
case/unit tests in the seven files that use `Array.from` pass, and so do the
runtime's 61 list-map/row-list tests. Deliberately breaking the runtime's hole
handling, iterator check or cache density made the new tests fail. Not run: the
full root suite, performance, browser layout and IDE activation.

## Continue

1. P3-EDITOR (first adapter/assets built, DX-36): verify the 0.0.2 desktop update with
   the compatible TypeScript provider and the real task board, then inferred
   projects and portability beyond the local VSIX. Reuse by other extensions is documented;
   a second editor still needs its own integration evidence.
   See [tooling](tooling.md#editor-extension-planned-p3-editor).
Done since: loops and `.map` share one closed-list path (see the reconcile
table). Compiler-next `src/optimize` and `src/features/handlers` tests and the
six case files using `Array.from` pass (644), with every closed-list case run in
both spellings; forcing the loop skip to ignore edits failed only the eight loop
variants that edit items. After the event-handler return change: the same
optimize/handlers/list case files (742) and the handler and component case files
(84) pass. Edits through destructured names (`entries()` loops) are shown
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
- Replay proofs and lowering-map composition remain open. Compiler-next now has
  project/application loading, Vite/HMR, delivery, source maps and declared server
  folders; connecting the full `.auwla` authoring path to those APIs and mapping
  normalized output back to authored files still needs its own acceptance work.
  Do not treat compiler capabilities as proof of `.auwla` project integration.

## Compiler-next changes to reconcile

Compiler-next is unfinished (branch `compiler-rewrite`) and is continued
separately. Under DX-34 this branch may change it for `.auwla` interop. All changes
currently listed below were adopted by `bd237a29`; retain the record and track
any new changes that must be adopted or corrected on `compiler-rewrite` later:

| Commit | Change | Why `.auwla` needs it |
| --- | --- | --- |
| `1d3ef3bf` | New read-only analysis API in `packages/compiler-next/src/analysis/`; `pipeline.ts` shares its frontend; `./analysis` package export ([compiler analysis](../wiki/compiler/analysis.md)) | The checking flow planner reads binding/dependency facts without DOM emission |
| `dbe46803` | `analysis/index.ts` re-exports `CompileError` | The planner skips modules the compiler rejects |
| `a35db526` | `analysis/serialize.ts` also describes JSX spread arguments (`{...props}`) as expressions | Spread inputs get flow checking like expression containers |
| `b05773b5` | `runtime/src/setters.ts`: uncached ARIA `false`/`true` follow the cached/spread rules, with a DOM test | Found by the task-board example; a runtime bug fix, not interop |
| `9620fb57` | New `optimize/mapping-calls.ts` ([optimize](../wiki/compiler/optimize.md#row-lists)). Row reuse and row lists accept the intrinsic `Array.from(items, row)`, with `rowReuse.form` added to the plan model. The runtime gains `fromRows`, `RowList.from`, `iteratedItems` and a `dense` cache mode. Closed lists stay `map`-only | Direct loops lower to `Array.from`; without this they never get compiled rows |
| `4072c829` | `features/handlers/plan.ts`: `aliasBindings` judges a destructured name by the declaration or parameter owning its pattern (`patternRoot`), with `features/handlers/aliases.test.ts` ([handlers](../wiki/compiler/handlers.md)) | `for (const [index, task] of tasks.entries())` row edits were not shown; a genuine bug, plain JSX too |
| `03958a19` | `optimize/closed-lists.ts`: the proof finds a row list's root through `mappingCall` (`#rowsOver`), replacing the `.map`-only branch in `#useMethod` and the `form` filter in `match`. `features/handlers/mutations.ts` emits `list.map`/`list.from` and `mapRows`/`fromRows` from one branch, passing `unedited` to both. `optimize/methods.ts` drops `withRowReuse`'s redundant `form` argument. Tests: both spellings in `closed-lists.test.ts` and `conditionals-and-lists.closed.test.ts` ([optimize](../wiki/compiler/optimize.md#closed-lists)) | Loops over plain state lists skip unchanged rows like `.map`, without a second copy of the list logic |
| `232c8f5b` | `optimize/closed-lists.ts`: `returnsToEventDispatch` lets `#useReturn` accept a function literal written as an `on*` attribute of a DOM element that is not `isComponentCall`, since the runtime keeps nothing it returns. Tests in `closed-lists.test.ts` (with controls) and a both-spelling behaviour case ([optimize](../wiki/compiler/optimize.md#closed-lists)) | `onClick=(() => rows.reverse())`, the natural `.auwla` one-liner, turned the skip off; plain JSX benefits too |

These histories used different commits for the same code before synchronization,
so commit-range output alone does not show whether a change was adopted. Compare
the compiler/runtime trees as well as the history; at this integration they are
identical to `07e996c9`.

See [plan](plan.md), [tooling](tooling.md) and [rewrite acceptance](../wiki/status.md).
