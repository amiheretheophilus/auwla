# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P3-FLOW: checking-flow contract and investigation built; four gaps remain.**

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

The new [checking-flow catalog](checking-flow.md) identifies four real narrowing
gaps: unchecked replay reads, a false `never` error on a guarded read, a replayed
derivation outside markup, and a changing prop used after `await`. Seven ref,
row/scope and ordinary-flow cases already match. The production checking
projection is unchanged; this slice specifies and exposes the problem rather
than applying an unsafe general wrapper or declaration-widening workaround.

## Baseline and evidence

The branch originated from `compiler-rewrite` at `595171c4`. This investigation
started from clean implementation baseline `14dfede0`. Results below cover its
flow fixtures, LSP probe, regression/runtime tests and documentation, rather than
claiming the baseline already included the implementation.

- In `packages/jsx-plus`, `bun check`: no type errors in 188 files.
- In that package, `bun test`: **99 passed, 0 failed, 413 assertions**, six files.
  Includes all 6 syntax-view/range fixtures, 5 primary diagnostic fixtures and
  9 extended behavior programs in both compiler modes (18 executions).
  Existing ref assignment/clearing and keyed node preservation are checked.
  The new flow test checks seven established matching cases and explicitly
  reports four gaps. Additional runtime tests execute guarded union children
  and guarded derivations outside markup in both modes, changing `READY` to `1`.
  Existing actual CLI/LSP diagnostics, safe rename, Unicode ranges and invalid/
  restore editing checks also remain covered.
- `bun run tests/probe-flow.ts --strict`: **failed, exit one** on
  `FLOW-TYPE-001` through `004`; seven other targets match. The package suite is
  not full checking-flow acceptance. Default probe mode is observation only.
- The independent `wiki2/spec/check.ts` baseline and its type check passed at
  `cdb9f359`: 27 fixture integrity checks, 7 host probes, 18 ordinary-JSX equivalent
  executions, no type errors in 172 files. Not rerun for this slice: its code,
  fixture catalog and compiler/runtime dependencies are unchanged. That runner
  labels extended syntax NOT RUN; package tests supply the separate evidence.
- A second agent reviewed this investigation before pushing: no blocking findings.
  It independently ran the 31 focused flow/runtime tests and the strict probe,
  confirmed all expected ranges and the four failing targets, and verified that
  the current bugs are not asserted as correct behavior.
- Documentation audit: 21 documents, 144 local links/heading targets and 34
  existing mapped paths checked with no errors. `git diff --check` passed.
- Full root suite and timing benchmarks were not run. This slice changes no
  shared compiler/runtime source and does not close their acceptance gates.

The current catalog is a tested subset, not exhaustive language conformance.
Find the implementation commit with `git log -1 -- packages/jsx-plus` and this
handoff with `git log -1 -- wiki2/status.md`.

## Next

P3-FACTS: define a small source-aware fact boundary for the checking projection:
binding identities, actual replay/derivation sites, possible updates and deferred
continuation boundaries. The existing public compiler API does not expose those
lightweight facts. Define how they can be shared without DOM emission, internal
compiler imports or a second reactivity classifier before writing flow scaffolding.
See [the next implementation slice](checking-flow.md#next-implementation-slice).
Then implement the smallest faithful projection against all eleven targets and
retain existing rename/edit and ordinary-scope checks. TOOL-05 remains open.

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
