# Prototype status

Updated: 2026-11-10. Branch: `prototype/jsx-plus`.

## Current slice

**P0-ALIGN complete: explicitly extend compiler-next and preserve existing refs.**

The design now records quoted literal text, direct expression/control-flow
children and normal declared refs through `ref={target}`. Detailed grammar is
still open. [syntax.md](syntax.md) and [refs.md](refs.md) own those contracts.

JSX+ adds authoring features to compiler-next's existing parse stage and feeds its
same resolve, graph, plan, optimize and emit stages. Refs, reactivity, list
identity and ownership already exist. Ref checks in this plan verify compatibility
with new syntax; they do not represent work to build refs again.

The docs now remove the standalone prototype-compiler package suggestion and map
planned syntax support inside compiler-next. Mapper/checking code is TypeScript
tooling only. This documentation slice changes no compiler or runtime code. The
new syntax examples remain design fixtures, not runnable TSX.

## Baseline and evidence

- Branch created from `compiler-rewrite` at `595171c4`.
- That commit checkpoints unnamed-source readiness work; compiler-next and data
  type checks passed for the checkpoint. Its behavior suites were not rerun.
  Do not count that work as newly verified by this documentation slice.
- Additional JSX+ syntax and mapper implementation: **not built**. Existing
  compiler-next features, including refs, are built and keep their current contracts.
- Documentation validation for P0-ALIGN is recorded with the finished slice below.

## Next

**P1-GRAMMAR:** turn the boundary questions in [syntax.md](syntax.md) into a small
fixture table. Compare candidate separator rules on adjacent expressions, closing
tags, comparisons, regexes and incomplete edits. Choose a provisional rule from
those results; do not settle it implicitly while implementing a parser.

Then pair an extension of compiler-next's parse stage with a TypeScript mapping probe.
See [plan.md](plan.md). Event shorthand and binding conveniences remain later work.

## Handoff cautions

- `.auwla` is the working extension in examples, not a finalized packaging choice.
- Attribute braces remain in examples; removing them has not been decided.
- The compiler rewrite's routing, Vite, acceptance and performance work stays in
  [wiki/status.md](../wiki/status.md). Prototype progress does not close those gates.
- Source ranges and TypeScript edit mappings need an early proof; successful
  rendering alone does not establish a usable authoring format.

## Latest finished slice

P0-ALIGN: document compiler continuity and existing refs, 2026-11-10.

- `bun run -` with an in-memory documentation audit: 13 documents, 87 local links
  including heading targets, 23 existing mapped paths and 6 explicitly planned
  path references; no problems. Code fences and stale standalone-package/syntax
  references were also checked.
- `git diff --check`: passed.
- Reviewed architecture, plan and concept pages for a single production pipeline,
  reuse of existing refs, and separation of the TypeScript checking projection.
- Runtime, compiler, mapper/editor and performance tests: not run for this
  documentation-only slice; no implementation gate is claimed.

Find this slice's commit with `git log -1 -- wiki2/status.md`; subsequent sessions
replace this evidence with the latest slice rather than appending a long run log.
