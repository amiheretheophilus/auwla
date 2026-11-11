# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P3-FACTS: first public compiler snapshot and authored-mapping adapter built.**

Compiler-owned inspection is grouped under
`packages/compiler-next/src/analysis/`: entry, types, shared frontend,
serialization and tests. `@memoized-dom/compiler-next/analysis` runs the existing
parse/resolve/graph sequence without planning, optimizing or emitting. Production
compilation calls that same extracted frontend and continues normally. No new
reactivity classifier or runtime behavior is introduced.

`packages/jsx-plus/src/checking/facts.ts` owns the opt-in authored adapter,
exported as `@memoized-dom/jsx-plus/checking/facts`. It preserves binding identity,
shadowing, unresolved/global inputs, live-import links, body builders and capture
facts. Locations explicitly distinguish `verbatim`, `enclosing` and `unmapped`.
Shifted runtime-TypeScript lowering returns `unavailable-after-lowering`; offsets
are not guessed. The source and normalization text identify each snapshot.

The `.auwla` grammar, checking projection and mappings remain in the separate
JSX+ package. The ordinary mapper does not yet use this new inspection entry.
The [four checking-flow gaps](checking-flow.md) therefore remain unresolved.
Classifications and lexical timing are not complete replay/invocation proofs.
The [compiler API page](../wiki/compiler/analysis.md) records those limits.

The code was expanded into readable helpers and blocks. The user now explicitly
requests **no sub-agents**, superseding their earlier review-agent instruction;
repository guidance records direct review and verification before pushing.

## Baseline and evidence

This slice started from clean baseline `4a8d430b`. Results cover the new analysis
folder, existing pipeline/export integration, JSX+ adapter/tests and docs.
Runtime/data/language-service implementations and dependencies are unchanged.

- Compiler-next `bun check`: no errors in 215 files.
- Compiler-next focused tests: **82 passed, 0 failed, 399 assertions**, five files.
  Command: `bun test src/analysis/analysis.test.ts src/core/graph/graph.test.ts src/core/parse/parse.test.ts tests/cases/core.test.ts tests/cases/refs.test.ts`.
  Covers the new API, existing graph/parse contracts, enum behavior and ref
  lifecycle/reference comparisons. Inspection leaves production output intact.
- JSX+ `bun check`: no errors in 194 files.
- JSX+ `bun test`: **106 passed, 0 failed, 463 assertions**, seven files.
  New tests cover authored facts, row shadowing, prop capture, lowered-coordinate
  refusal, unresolved provenance and UTF-16/CRLF. Existing actual CLI/LSP rename,
  diagnostics, editing and runtime cases remain covered.
- `bun run tests/probe-flow.ts --strict` in JSX+: **failed, exit one**, exactly
  `FLOW-TYPE-001` through `004`; seven other targets match. Package-suite success
  does not establish complete checking-flow acceptance.
- Direct code review completed, including coordinate provenance, missing global/
  import dependencies, builders, no AST mutation and package boundaries.
- Documentation audit: 26 documents, 168 local links/heading targets and 37
  mapped package paths passed; all five compiler analysis files exist in their
  concept folder. `git diff --check` passed.
- Full root suite, timing benchmarks, SSR/adoption and editor acceptance were
  not run. No general performance claim follows from these focused checks.

Find this slice's commit with `git log -1 -- packages/compiler-next/src/analysis`.
The language spec remains draft 0.1 revision 1; this integration changes no grammar.

## Next

P3-PROJECT: use the first fact snapshot to design a faithful checking-flow
projection. Preserve guards within each evaluation, readonly/inferred values,
ordinary host narrowing, row scope, deferred captures and `await`/`yield` contexts.
Do not treat a binding kind, an empty named-input list or lexical write timing
as a complete execution proof. Keep generated scaffolding unmapped.

Validate against all eleven flow targets and existing rename/edit cases before
activating the new facts in the ordinary mapper. Full replay regions, lowering
maps, incremental caching and multi-module editing remain additional work.

Parser recovery/scalability also remains open: ASI ambiguities, malformed token
recovery, repeated suffix parsing and checking the remainder of incomplete files.
See [plan.md](plan.md), [tooling.md](tooling.md) and [syntax.md](syntax.md).

## Other boundaries

- Existing refs, reactivity, lists and ownership remain compiler-next/runtime work.
- Backend `.auwla` configuration/loading is planned; that code will be ordinary
  nonreactive backend code. Isomorphic support comes later.
- Multi-module production loading, Vite, editor registration, delivery and final
  JavaScript debugging maps are not established by this slice.
- The rewrite's acceptance/performance gates remain in [wiki/status.md](../wiki/status.md).
