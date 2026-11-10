# Prototype status

Updated: 2026-11-10. Branch: `prototype/jsx-plus`.

## Current slice

**P0-DOC complete: establish the authoring direction and a revisable work map.**

The design now records quoted literal text, direct expression/control-flow
children and normal declared refs through `ref={target}`. Detailed grammar is
still open. [syntax.md](syntax.md) and [refs.md](refs.md) own those contracts.

This slice updates `dx.md`, adds this wiki, and routes future sessions here from
`AGENTS.md` and the existing wiki. No JSX+ parser, mapper or runtime implementation
has been added. The new examples are design fixtures, not runnable TSX.

## Baseline and evidence

- Branch created from `compiler-rewrite` at `595171c4`.
- That commit checkpoints unnamed-source readiness work; compiler-next and data
  type checks passed for the checkpoint. Its behavior suites were not rerun.
  Do not count that work as newly verified by this documentation slice.
- Prototype implementation and editor behavior: **not verified; not built**.
- Documentation validation for P0-DOC is recorded with the finished slice below.

## Next

**P1-GRAMMAR:** turn the boundary questions in [syntax.md](syntax.md) into a small
fixture table. Compare candidate separator rules on adjacent expressions, closing
tags, comparisons, regexes and incomplete edits. Choose a provisional rule from
those results; do not settle it implicitly while implementing a parser.

Then pair a minimal parser/lowering experiment with a TypeScript mapping probe.
See [plan.md](plan.md). Event shorthand and binding conveniences remain later work.

## Handoff cautions

- `.auwla` is the working extension in examples, not a finalized packaging choice.
- Attribute braces remain in examples; removing them has not been decided.
- The compiler rewrite's routing, Vite, acceptance and performance work stays in
  [wiki/status.md](../wiki/status.md). Prototype progress does not close those gates.
- Source ranges and TypeScript edit mappings need an early proof; successful
  rendering alone does not establish a usable authoring format.

## Latest finished slice

P0-DOC: documentation and planning, verified in this change on 2026-11-10.

- `bun run -` with an in-memory documentation audit: 13 documents, 83 local links
  (including linked headings), 23 existing mapped paths; no problems. It also
  checks code-fence balance and removal of stale wrapped-control-flow/ref-tag
  examples. Future prototype paths are explicitly labeled planned.
- `git diff --check`: passed.
- Reviewed examples for quoted text, direct expression/control-flow children,
  explicit ref declarations, unchanged attribute notation and open grammar choices.
- Runtime, compiler, mapper/editor and performance tests: not run for this
  documentation-only slice; no implementation gate is claimed.

Find this slice's commit with `git log -1 -- wiki2/status.md`; subsequent sessions
replace this evidence with the latest slice rather than appending a long run log.
