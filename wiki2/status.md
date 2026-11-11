# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P3-TOOL: first real TypeScript CLI/LSP content-mapper probe built.**

`packages/jsx-plus` (`@memoized-dom/jsx-plus`) owns new syntax and copied-span
mappings. Its normalizer produces standard TSX; its single-UI-module `compile()`
facade calls compiler-next's public API. Existing compiler-next/runtime/data
source files are unchanged. Reactivity, refs, list identity, scheduling and
ownership continue to use their existing implementations.

DX-31 records the user's separate-package instruction. It supersedes earlier
in-place syntax placement, while preserving DX-28's same-pipeline requirement.
The [language spec](spec/README.md) remains draft 0.1, revision 1; its organization
was informed by `snrraptopack/jasx` at `d055ed85`, without adopting Java semantics.

Quoted text, direct expression children, nested markup, block-bodied `if`/`else`
and ordinary `.map()` work for the current fixtures. Ordinary attribute/ref
spellings remain unchanged. Explicit `.tsx` module input keeps existing JSX text
semantics. A runnable [counter](../packages/jsx-plus/examples/counter.auwla) is
included and exercised by the execution tests.

The separate checking export and mapper process reuse the same normalizer,
without loading DOM compilation. A typed-prop/ref example now checks through
TypeScript's CLI and language server. Actual ref rename edits cover declaration,
prop, handler and child read; applying/rechecking succeeds. Unicode diagnostics
and an incomplete-quote/restore editing cycle retain authored locations.

## Baseline and evidence

The branch originated from `compiler-rewrite` at `595171c4`. This tooling slice
started from clean implementation baseline `946e56e7`. Results below cover its
checking projection, transport, examples, tests, package/lockfile and docs, rather than
claiming the baseline already included the implementation.

- In `packages/jsx-plus`, `bun check`: no type errors in 186 files.
- In that package, `bun test`: **94 passed, 0 failed, 394 assertions**, five files.
  Includes all 6 syntax-view/range fixtures, 5 primary diagnostic fixtures and
  9 extended behavior programs in both compiler modes (18 executions).
  Existing ref assignment/clearing and keyed node preservation are checked.
  New tooling cases run the real mapper and TypeScript 7.1-beta CLI/LSP, including
  exact copied-span/edit fidelity, project close/reopen/isolation, CLI permission,
  all four ref rename uses and edited-source rechecking, a UTF-16 diagnostic after
  an emoji, and an incomplete-quote diagnostic followed by valid-source restoration.
- The independent `wiki2/spec/check.ts` baseline and its type check passed at
  `cdb9f359`: 27 fixture integrity checks, 7 host probes, 18 ordinary-JSX equivalent
  executions, no type errors in 172 files. Not rerun for this slice: its code,
  fixture catalog and compiler/runtime dependencies are unchanged. That runner
  labels extended syntax NOT RUN; package tests supply the separate evidence.
- A second agent reviewed all code and tests before pushing: no blocking findings.
  It independently ran the two tooling files (5 passing tests) and the final LSP
  edit-cycle test, and checked mapper shutdown on input-stream closure.
- Documentation audit: 20 documents, 134 local links/heading targets and 31
  existing mapped paths checked with no errors. `git diff --check` passed.
- Full root suite and timing benchmarks were not run. This slice changes no
  shared compiler/runtime source and does not close their acceptance gates.

The current catalog is a tested subset, not exhaustive language conformance.
Find the implementation commit with `git log -1 -- packages/jsx-plus` and this
handoff with `git log -1 -- wiki2/status.md`.

## Next

Continue P2/P3 together. First probe TypeScript's control-flow view of ref reads
and reactive values (TOOL-05); the basic TSX projection does not model compiler-owned
ref writes or replay. Preserve failing examples and specify any checking-only
scaffolding before implementing it. Do not replace errors with blanket `any`.
Completion, auto-import and cross-file edits also need explicit acceptance cases.
See [tooling.md](tooling.md).

Keep parser recovery/scalability active: ASI ambiguities, malformed comment/regex
recovery, and repeated suffix parsing/masking remain open. Partial-file checking
after syntax failure is not implemented. See [syntax.md](syntax.md) and
[plan.md](plan.md). Final-JavaScript debugging source maps remain separate work.

## Handoff cautions

- The facade currently compiles one UI module. Multi-module production `.auwla`
  resolution, Vite integration, editor activation and SSR/adoption remain open.
- Verified tooling: Windows, TypeScript `7.1.0-beta` (git head
  `3e9236361fa97a9e6c685f4833ac457ae2d8c50a`), JSON-RPC 9.0.2, Bun mapper launch.
  CLI uses `--runExternalCode`; this beta's LSP uses `--lsp --stdio` with
  `initializationOptions.runExternalCode: true`. See the exact
  [tooling settings](tooling.md#verified-toolchain-and-transport).
- The transport has no VS Code editor dependency. Compatible IDE integration
  still needs verification; no editor/version matrix acceptance is claimed.
- Complete host-expression coverage and malformed-input recovery are unfinished.
  Unsupported contexts are implementation gaps, not a decision to restrict JS.
- Direct child declarations/loops, event shorthand, modifiers and CSS conveniences
  remain outside this first profile. Attribute brace removal is undecided.
- DX-30 records ordinary nonreactive backend `.auwla` files/folders selected by
  future config, including Express imports. Config/loading are planned;
  isomorphic support follows later. The UI facade does not implement that path.
- The rewrite's routing, Vite, acceptance and performance work stays in
  [wiki/status.md](../wiki/status.md). Prototype progress does not close it.
- Revise provisional grammar with fixtures and the spec changelog when evidence
  calls for it. Keep the separate package boundary and reuse existing refs.
