# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P2-ATTR and P3-EDITING: parenthesized values and a real completion edit built.**
DX-32/spec revision 2 adds `prop=(expression)` alongside existing JSX attribute
braces. The separate `src/attributes/parenthesized.ts` reader uses host tokens,
preserves authored parentheses/expression spans and inserts unmapped JSX braces.
Existing refs, native host contexts and ordinary event-value timing remain.
Bare/lazy event calls were discussed and dropped at the user's direction.

The task-board example now uses the new form for a row label, a status prop,
an explicit callback and its ref. A real TypeScript LSP test completes `task.ti`
to `task.title`, resolves its type, applies the server's actual authored
insert/replace edit and rechecks without diagnostics.

The user also requested ordinary loops. `examples/task-board/ForLoop.auwla`
builds typed row values with a host `for...of` before rendering `<ul>rows</ul>`.
Its separate row closures and add/filter/toggle/remove flow are exercised in both
compiler modes. Run it with `bun run examples/task-board/preview.ts --for-loop`
from `packages/jsx-plus`. Direct `for` statements inside markup remain planned.

This example exposed an existing shared runtime bug: uncached attribute writes
omitted ARIA false and wrote true as an empty attribute. The narrow
`runtime/src/setters.ts` fix now follows the existing cached/spread rules; see
[compiler core](../wiki/compiler/core.md#dynamic-attribute-values). Compiler-next's
implementation is unchanged. Syntax/tooling code remains in JSX+.

## Baseline and evidence

This slice started from clean baseline `2768adc5`. Evidence covers the attribute
reader, draft revision, real example files, editor completion and runtime fix.

- JSX+ `bun check`: no errors in 203 files.
- JSX+ `bun test`: **148 passed, 0 failed, 778 assertions**, ten files.
  Includes all 34 flow targets, actual CLI checks for both authored apps and their
  entrypoints, native LSP completion/rename/error ranges, masks/maps, malformed
  attribute literals, await/yield contexts, cache reuse and live app behavior.
- `bun run examples/task-board/preview.ts --build` and the same command with
  `--for-loop --build`: both browser bundles build from current runtime source.
- Root `bun run wiki2/spec/check.ts`: 30 fixture-integrity checks, 7 host checks
  and 20 existing-JSX baseline executions pass. It explicitly does not run
  extended parsing; the JSX+ suite separately checks those sources.
- Root `bun check -p wiki2/spec/tsconfig.json`: no errors in 173 files.
- Runtime `bun check -p packages/runtime/tsconfig.build.json` from root:
  no errors in 78 files.
- Root `bun test ./packages/runtime/tests/dom-attributes.test.ts ./packages/runtime/tests/markup.test.ts`:
  **9 passed, 58 assertions**. Pins HTML/SVG ARIA true/false/removal and existing
  HTML boolean behavior, plus template/namespace/adoption checks.
- Compiler-next `bun test tests/cases/core.test.ts tests/cases/refs.test.ts`:
  **20 passed, 220 assertions** against current runtime source.
- Direct review covers expression grouping/evaluation, nested markup, exact
  UTF-16/CRLF spans, comment-aware literal locations, explicit source format,
  native completion edits and shared attribute semantics. No sub-agents.
- Documentation audit: 28 documents, 196 local links/heading targets and 49
  mapped package paths pass. All original spec fixtures are unchanged; revision 2
  adds three cases. `git diff --check` passes.
- Full root suite, timing benchmarks, browser layout, SSR/adoption acceptance and
  IDE activation were not run. No general performance/editor claim follows.

Find the slice with `git log -1 -- packages/jsx-plus/src/attributes`.
The language spec is draft 0.1 revision 2; its changelog records the added grammar.

## Next

Continue P3-EDITING with additional real completion/auto-import contexts and
partial-file recovery. Syntax errors must stay authored errors; previous cached
successful text must never hide the current malformed input. The current error
projection still does not check the rest of an incomplete file.

Direct markup loops require a separate draft covering scope, evaluation order,
abrupt completion, await/yield and existing ownership/list integration. The normal
host-loop example does not establish that future syntax.

Broader replay/contextual-typing proofs, lowering maps, multi-module loading,
Vite/HMR, delivery and final-JavaScript debugging maps remain open. Backend
`.auwla` selection/configuration stays planned and nonreactive; isomorphic support
comes later. See [plan](plan.md), [tooling](tooling.md) and
[rewrite acceptance](../wiki/status.md).
