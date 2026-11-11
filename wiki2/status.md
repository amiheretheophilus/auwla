# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P2-ATTR-ID: bare identifier attribute values built.** DX-33/spec revision 3
accepts `prop=name`, including the user's `onClick=addTask`. It normalizes to
ordinary JSX `prop={name}`, preserving the identifier's spelling, lexical binding
and native event arguments. No implicit call or callback wrapper is generated.

The new `src/attributes/identifier.ts` reader validates each delimited candidate
with the host parser. Parser-only assignment masking keeps opening-tag scanning
valid for one-character names and preserves UTF-16 width/newlines. Emitted values
retain copied identifier spans between unmapped generated braces. Parenthesized
and existing JSX values remain supported. Calls, members and other expressions
still require parentheses or braces; event timing is unchanged.

Actual examples use bare `onClick=addTask` in `ForLoop.auwla` and
`onSubmit=addTask` in `App.auwla`. The form handler uses its native event argument.
Both apps execute through compiler-next in both modes. A real LSP check renames
the bare submit handler plus its declaration, applies only authored edits and
rechecks without errors.

Compiler-next and runtime implementation are unchanged in this slice. The prior
ordinary-loop example and shared ARIA setter fix remain in place. Syntax/tooling
work stays in the separate JSX+ package.

## Baseline and evidence

This slice started from clean baseline `b05773b5`. Evidence covers the identifier
reader, revision 3, real authored apps, native mapper paths and documentation.

- JSX+ `bun check`: no errors in 204 files.
- JSX+ `bun test`: **168 passed, 0 failed, 845 assertions**, ten files.
  Includes all 34 flow targets, actual CLI checks for both apps/entrypoints,
  native LSP handler/ref/state rename and applied member completion, copied spans,
  Unicode/escaped identifiers, CRLF, tag boundaries, unsupported bare forms and
  normal event delivery. All original spec fixtures retain their expectations.
- `bun run examples/task-board/preview.ts --build` and the same command with
  `--for-loop --build`: both current browser bundles build successfully.
- Root `bun run wiki2/spec/check.ts`: 32 fixture-integrity checks, 7 host checks
  and 22 existing-JSX baseline executions pass. This baseline checker does not
  run extended parsing; the JSX+ package separately checks extended source.
- Root `bun check -p wiki2/spec/tsconfig.json`: no errors in 173 files.
- Direct review covers delimiter boundaries, host identifier validation, exact
  masks/spans, mixed attribute forms, source-format selection, event values and
  actual rename application. No sub-agents, following user direction.
- Documentation audit: 28 documents, 198 local links/heading targets and 50
  mapped package paths pass. All 30 original spec fixtures are unchanged;
  revision 3 adds two cases. `git diff --check` passes.
- Full root suite, timing benchmarks, browser layout, SSR/adoption acceptance and
  IDE activation were not run. No complete editor/performance claim follows.

Find the slice with `git log -1 -- packages/jsx-plus/src/attributes/identifier.ts`.
The language spec is draft 0.1 revision 3; the changelog records the new spelling.

## Next

Continue P3-EDITING with more real completion/auto-import contexts and partial-file
recovery. Syntax errors must remain authored errors; previous cached successful
text must never hide the current malformed input. The current syntax-error
projection still does not check the remainder of an incomplete file.

Direct markup loops remain a separate draft task; the existing `ForLoop.auwla`
uses normal host JavaScript before markup. Broader replay/contextual-typing
proofs, lowering maps, multi-module loading, Vite/HMR, delivery and final-JavaScript
maps remain open. Backend selection/configuration stays planned and nonreactive;
isomorphic support comes later. See [plan](plan.md), [tooling](tooling.md) and
[rewrite acceptance](../wiki/status.md).
