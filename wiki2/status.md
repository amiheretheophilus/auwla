# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P1-SPEC/P1-GRAMMAR complete as draft 0.1, revision 1.**

The [language spec](spec/README.md) now defines a first core profile: quoted text,
direct expression children, block-bodied conditional children, source ranges,
syntax-view/schema, evaluation rules, diagnostics and conformance fixtures.
Precise rules live in the spec; concept pages map implementation and open work.

JSX+ adds authoring features to compiler-next's existing parse stage and feeds its
same resolve, graph, plan, optimize and emit stages. Refs, reactivity, list
identity and ownership already exist. Ref checks in this plan verify compatibility
with new syntax; they do not represent work to build refs again.

The spec follows the organization of `snrraptopack/jasx` at commit `d055ed85`,
without adopting its Java/target semantics. New syntax is not implemented yet.
Only specification/fixtures/checking utilities and the documentation map changed;
no production compiler or runtime code changed.

## Baseline and evidence

- Branch created from `compiler-rewrite` at `595171c4`.
- That commit checkpoints unnamed-source readiness work; compiler-next and data
  type checks passed for the checkpoint. Its behavior suites were not rerun.
  Do not count that work as newly verified by this documentation slice.
- Additional JSX+ syntax and mapper implementation: **not built**. Existing
  compiler-next features, including refs, are built and keep their current contracts.
- Last clean documentation baseline: `31e9549b`. Results below are for this
  spec change's working tree, not a claim that baseline contained these fixtures.

## Next

**P2-PARSE**, paired early with P3 tooling: implement the first quoted/direct-child
fixtures in compiler-next's existing parse stage, preserving authored ranges and
existing refs. Start with PARSE-001/002/004/006 and TEXT-001/002, then extend the
subset. List supported IDs and remaining cases; do not claim whole-level parser
conformance from a partial implementation. See [plan.md](plan.md).

The draft boundary rule preserves host continuation/ASI and uses explicit
separators at ambiguity. It is provisional and can be revised with fixtures and
the spec changelog. Direct `if` execution follows in P4; other features remain
later profiles. Resolve new syntax questions in the spec before encoding them.

## Handoff cautions

- `.auwla` is the working extension in examples, not a finalized packaging choice.
- Attribute braces remain in examples; removing them has not been decided.
- The core draft does not settle every feature in `dx.md`; event shorthand,
  modifiers, direct child loops/declarations and CSS conveniences remain open.
- DX-30 records nonreactive backend `.auwla` authoring through configured backend
  files/folders, including Express imports. Config/loading are planned; isomorphic
  support follows later. This is a note, not an implemented backend feature.
- The compiler rewrite's routing, Vite, acceptance and performance work stays in
  [wiki/status.md](../wiki/status.md). Prototype progress does not close those gates.
- Source ranges and TypeScript edit mappings need an early proof; successful
  rendering alone does not establish a usable authoring format.

## Latest finished slice

P1-SPEC/P1-GRAMMAR: initial specification and baseline evidence, 2026-11-11.

- `bun run wiki2/spec/check.ts`: 27 fixtures checked for integrity; 6 syntax-view
  expectations and 5 diagnostic expectations have valid authored ranges, 7 host
  parser probes pass, and 9 existing-JSX equivalents pass in optimized/general
  modes (18 executions). Includes keyed node preservation and existing ref
  identity/clearing. Extended parse/diagnostics/execution explicitly report NOT RUN.
- `bun check -p wiki2/spec/tsconfig.json`: no errors in 172 files.
- Documentation audit: 20 documents, 127 local links including heading targets,
  23 existing mapped paths; no problems. `git diff --check` passed.
- Mapper/editor, extended-source runtime/SSR/adoption and performance gates:
  not run; their implementation is not claimed.

Find this slice's commit with `git log -1 -- wiki2/status.md`; subsequent sessions
replace this evidence with the latest slice rather than appending a long run log.

Latest clarification: DX-30, 2026-11-11, records backend authoring as above. Only
documentation changed; the core grammar, fixture catalog and checker are unchanged.
Documentation audit: 20 documents and 131 local links passed; `git diff --check`
passed. Runtime/compiler checks were not rerun for this note.
