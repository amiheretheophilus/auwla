# JSX+ package boundary

Read the repository `AGENTS.md`, then `wiki2/README.md`, `wiki2/status.md` and the
relevant `wiki2/spec/` rules. Implementation maps live in `wiki2/architecture.md`
and `wiki2/syntax.md`.

- This separate package owns extended syntax, normalization, authored mappings
  and the compiler-next public-API adapter. Keep implementation here.
- Production compilation depends on compiler-next's public exports and yuku. It does
  not copy compiler-next's graph, optimizer, emitters, runtime or ref feature.
- DX-39 (2026-11-13): JSX+ is a standalone template layer. For builds it gives only
  `auwla`, a compiler-next source language (`src/language.ts`). Projects, imports
  across files, applications, the CLI, the Bun and Vite plugins, source maps and hot
  updates are compiler-next's: pass `languages: [auwla]` to them. Never add a project
  wrapper, build graph, bundler plugin or map composer here, and never use Bun or
  Node APIs in `src/` (examples and tests may). A missing build capability belongs in
  compiler-next's generic hook, recorded under DX-34. The user rejected and discarded
  an agent's JSX+ project wrapper and Bun plugin for exactly this reason.
- The separate checking export imports the normalizer directly. Mapper transport
  uses JSON-RPC streams and must not load the production compiler facade.
- Treat compiler-next/runtime sources as dependencies. Under DX-34 (2026-11-11),
  this branch may change compiler-next where `.auwla` interop needs it; keep
  syntax code here, and list each change in `wiki2/status.md` under "Compiler-next
  changes to reconcile" so the rewrite can adopt or correct it later.
- P3-FACTS adds a compiler-owned read-only public integration API, with all new
  files under compiler-next's `src/analysis/`. Extended syntax, checking
  transforms and authored mappings remain in this package.
- Run `bun check` and `bun test` in this package. Root-suite execution and timing
  benchmarks are not routine checks for this isolated slice.
- Review and verify code directly before pushing. Do not use sub-agents: the
  user's latest instruction supersedes the earlier second-agent review request.
- Keep conformance claims scoped to tested cases. Report missing host contexts,
  tooling, module-graph integration and delivery coverage rather than implying
  a complete language implementation.
- The user wants actual authoring code in `examples/`, not only small inline test
  programs. Extend the real examples as features grow and check those same files
  through the applicable mapper/compiler paths. See `examples/README.md`.
