# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P3-PROJECT: first paired TypeScript checking profile built.** The four known
flow gaps are fixed in the original fixtures. All twenty flow targets now match
through the actual pinned TypeScript LSP; full TOOL-05 acceptance remains open.

The original TSX view retains ordinary narrowing and editor symbols. A supplemental
view uses existing compiler analysis facts to widen typed state seeds and expose
possible prop changes. Only selected dependent regions use its diagnostics.
Generated scaffolding stays unmapped; supplemental mappings cannot produce
editor edits. Authored expressions keep their function and await/yield contexts.
See [checking flow](checking-flow.md) for routing, cases and limitations.

Implementation stays in `packages/jsx-plus/src/checking/`: `protocol.ts`,
`flow/plan.ts`, `flow/render.ts` and the existing `project.ts` entry. The only
compiler-next change exposes its existing `CompileError` through the dedicated
`src/analysis/` public entry, with a focused test. No grammar, runtime or production
emission changes; no second reactivity classifier.

## Baseline and evidence

This slice started from clean baseline `1d3ef3bf`. Results below cover the paired
projection, expanded catalog, direct review and documentation in this commit.

- JSX+ `bun check`: no errors in 198 files.
- JSX+ `bun test`: **112 passed, 0 failed, 554 assertions**, eight files.
  Covers extended parsing/execution, actual CLI/LSP diagnostics, applied ref/state
  renames, projection coverage, generated spans and lowering fallback.
  Final rename-assertion tightening was rechecked separately with
  `bun test tests/mapper-lsp.test.ts`: 2 passed, 39 assertions, including the
  returned authored filename and every replacement text.
- JSX+ `bun run tests/probe-flow.ts --strict`: **20 matches, exit zero**.
  Original eleven expectations retained; nine cases add synchronous narrowing,
  genuine errors, inferred values, object mutation, await and yield.
- Compiler-next `bun check`: no errors in 215 files.
- Compiler-next `bun test src/analysis/analysis.test.ts`: **8 passed, 0 failed,
  29 assertions**. Existing facts and production-output stability remain covered.
  The earlier shared-frontend slice's 82-test graph/parse/core/ref run is historical
  evidence at `1d3ef3bf`; that whole batch was not repeated for this export change.
- Direct review covers protocol range merging, exact mapping composition,
  diagnostic coverage, supplemental edit masks, initializer precedence and
  unsupported-input fallback. No sub-agents, following the user's instruction.
- Documentation audit: 26 documents, 170 local links/heading targets and 41
  mapped package paths passed. `git diff --check` passed.
- Full root suite, timing benchmarks, SSR/adoption and IDE activation were not
  run. No general performance claim follows from these checks.

Find the slice's commit with `git log -1 -- packages/jsx-plus/src/checking/flow`.
The language spec remains draft 0.1 revision 1; no grammar revision is needed.

## Next

P3-HARDEN: expand counterexamples for cross-binding dependencies, deferred
invocation and contextual typing before broadening the bounded checking profile.
Primary hover/completion flow accuracy, full replay proofs, module-level state,
live imports, lowering maps and multi-module editing remain open.

The current fallback keeps ordinary TSX checking for unsupported/lowered input;
it does not fix reactive flow there. Incremental caching, parser recovery and
repeated-suffix parsing also need separate evidence. See [plan.md](plan.md),
[tooling.md](tooling.md) and [syntax.md](syntax.md).

## Other boundaries

- Existing refs, reactivity, lists and ownership remain compiler-next/runtime work.
- Backend `.auwla` configuration/loading is planned; that code is ordinary
  nonreactive backend code. Isomorphic support comes later.
- Multi-module production loading, Vite, IDE registration, delivery and final
  JavaScript debugging maps are not established by this slice.
- The rewrite's acceptance/performance gates remain in [wiki/status.md](../wiki/status.md).
