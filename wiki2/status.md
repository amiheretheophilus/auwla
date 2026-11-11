# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P2-PARSE: first implementation slice built in its own package.**

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

## Baseline and evidence

The branch originated from `compiler-rewrite` at `595171c4`. This implementation
started from clean documentation baseline `c7503ff8`. Results below cover this
slice's package, workspace lockfile and documentation changes, rather than
claiming the baseline already included the implementation.

- In `packages/jsx-plus`, `bun check`: no type errors in 179 files.
- In that package, `bun test`: **52 passed, 0 failed, 121 assertions**, two files.
  Includes all 6 syntax-view/range fixtures, 5 primary diagnostic fixtures and
  9 extended behavior programs in both compiler modes (18 executions).
  Existing ref assignment/clearing and keyed node preservation are checked.
  Additional cases cover lexical boundaries, mappings, Unicode/CRLF, the counter,
  unchanged TSX semantics and conditional-test precedence in both modes.
- `bun run wiki2/spec/check.ts`: 27 fixture integrity checks, 7 host probes and
  18 ordinary-JSX equivalent executions pass. This independent baseline runner
  still labels extended syntax NOT RUN; the package suite above supplies that
  separate evidence.
- `bun check -p wiki2/spec/tsconfig.json`: no errors in 172 files.
- Documentation audit: 20 documents, 127 local links/heading targets and 23
  existing mapped paths checked with no errors. `git diff --check` passed.
- Full root suite and timing benchmarks were not run. This slice changes no
  shared compiler/runtime source and does not close their acceptance gates.

The current catalog is a tested subset, not exhaustive language conformance.
Find the implementation commit with `git log -1 -- packages/jsx-plus` and this
handoff with `git log -1 -- wiki2/status.md`.

## Next

**P2-HARDEN**, paired early with **P3-TOOL**. Expand host-expression contexts and
malformed-input cases, especially async/generator contexts and syntax inside
attributes/templates. Preserve reduced failures and exact authored ranges.
Measure and improve repeated suffix parsing/masking before any frontend
scalability claim. See [syntax.md](syntax.md) and [plan.md](plan.md).

Then prove a minimal TypeScript checking projection: one intentional diagnostic
at its authored span and one safe rename edit. Reuse the normalizer's source
understanding, keeping generated scaffolding unmapped. Exact copied-span mappings
already exist; a real content mapper and final-JavaScript debugging source maps
do not. See [tooling.md](tooling.md).

## Handoff cautions

- The facade currently compiles one UI module. Multi-module `.auwla` resolution,
  Vite integration, editor/mapper integration and SSR/adoption remain open.
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
