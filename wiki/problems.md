# Structural problems in the current compiler

Found while fixing readiness (`73f5f34`). Each one makes fixes fragile and is a
reason for the refactor in `plan.md`.

Size on the merged tree (2026-10-18): `packages/compiler/src` has 254 files and
about 50.8k lines (`dom/` 15.5k, `analysis/` 8.4k). `Ctx` has 118 fields. There are
31 `refreshAstAnalysis(...)` calls and 21 `refresh()` calls (re-analysis after
mutation), and 45 `__memoDom*` marker uses.

- **One concept, many passes.** Source reads are handled in
  `dom/module-read-lowering.ts`, `dom/read-rewriting.ts`, `dom/group-lowering.ts`
  and `dom/initial-dom.ts`. A fix in one pass must be mirrored by hand in the others.
- **In-place AST mutation with skip markers.** Passes rewrite the AST and leave flags
  so later passes skip their output: `insideDerivationInit`, `choiceReads`,
  `__memoDomRenderGated`, `isGeneratedDataCall`, `annotateAsyncRead`.
  Order between passes is load-bearing and undocumented.
- **Facts keyed by node identity.** Analysis maps hold AST nodes; cloning a node
  loses its facts, and every edit needs `refreshAstAnalysis()` / `refresh()`.
- **A giant mutable `Ctx`.** Every pass reads and writes shared maps
  (`transparentSources`, `transparentStateSeeds`, `transparentOwnerSources`, ...).
  Nothing says which pass owns which field.
- **Component ids exist only at emission.** Earlier passes cannot name a component's
  entities, so they record side facts on `Ctx` for the backend to emit later.
- **Semantics depend on syntax shape.** For example, a helper in the same module that
  returns `$fetch` is not recognized as a source factory, while the same helper
  imported from another module is.
