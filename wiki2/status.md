# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P3-HARDEN: receiving contexts and cross-binding cases checked.** All 34 flow
targets match through the actual pinned TypeScript LSP. The original twenty
expectations are unchanged; full TOOL-05 acceptance remains open.

The original TSX view retains ordinary narrowing and editor symbols. A supplemental
view uses existing compiler analysis facts to widen typed seeds/body assignments
and expose possible prop changes. Selected diagnostic contexts include receiving
declarations and JSX opening elements, preserving native assignability errors.
Generated scaffolding stays unmapped; supplemental mappings cannot produce
editor edits. Authored expressions keep their function and await/yield contexts.
See [checking flow](checking-flow.md) for routing, cases and limitations.

Implementation stays in `packages/jsx-plus/src/checking/flow/`, including the new
`syntax.ts` parent index. Typed identity calls validate copied initializers before
widening, including reassigned derivations and contextual function parameters.
Compiler-next's existing `src/analysis/serialize.ts` now exposes ordinary JSX
spread inputs through its existing query, with a focused test. No grammar,
runtime or production emission changes; no second reactivity classifier.

## Baseline and evidence

This slice started from clean baseline `dbe46803`. Results below cover diagnostic
context routing, seed validation, 14 added catalog cases and four runtime checks.

- JSX+ `bun check`: no errors in 199 files.
- JSX+ `bun test`: **116 passed, 0 failed, 628 assertions**, eight files.
  Covers extended parsing/execution, actual CLI/LSP diagnostics, applied ref/state
  renames, projection coverage, generated spans and lowering fallback.
  Guarded body-assignment and generic-helper fixtures execute through compiler-next
  in both optimization modes, independently of checking. The added flow cases
  also cover named deferred versus immediate invocation, receiving-type errors,
  two-step derivations, unrelated invalid props and helper type-argument scope.
- JSX+ `bun run tests/probe-flow.ts --strict`: **34 matches, exit zero**.
  Original twenty sources and expected diagnostic spans retained.
- Compiler-next `bun check`: no errors in 215 files.
- Compiler-next `bun test src/analysis/analysis.test.ts`: **9 passed, 0 failed,
  31 assertions**. Includes spread dependency identity and unchanged output around
  inspection. The shared frontend and production graph/emitter are unchanged.
- Direct review covers protocol range merging, exact mapping composition,
  diagnostic coverage, contextual argument validation, helper scope, direct-body
  assignment limits and unsupported-input fallback. No sub-agents, following the
  user's instruction.
- Final helper extraction was rechecked with `bun check` and
  `bun test tests/checking-flow.test.ts tests/checking-projection.test.ts`:
  6 passed, 99 assertions. Documentation audit: 26 documents, 170 local links/
  heading targets and 42 mapped paths passed; original twenty fixtures unchanged.
  `git diff --check` passed.
- Full root suite, timing benchmarks, SSR/adoption and IDE activation were not
  run. No general performance claim follows from these checks.

Find the slice's commit with `git log -1 -- packages/jsx-plus/src/checking/flow`.
The language spec remains draft 0.1 revision 1; no grammar revision is needed.

## Next

P3-CACHE: add bounded project-local transform reuse with exact source/configuration
invalidation and handle-close/isolation tests. Record actual reuse counts before
making any latency claim; inspection currently reruns for every transform.

Broader contextual typing, primary hover/completion flow accuracy, complete replay
proofs, uninitialized/destructured seeds, nested/compound body assignments,
module-level state, live imports, lowering maps and multi-module editing remain open.

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
