# JSX+ package boundary

Read the repository `AGENTS.md`, then `wiki2/README.md`, `wiki2/status.md` and the
relevant `wiki2/spec/` rules. Implementation maps live in `wiki2/architecture.md`
and `wiki2/syntax.md`.

- This separate package owns extended syntax, normalization, authored mappings
  and the compiler-next public-API adapter. Keep implementation here.
- Production code depends on compiler-next's public exports and yuku. It does
  not copy compiler-next's graph, optimizer, emitters, runtime or ref feature.
- Treat compiler-next/runtime sources as dependencies; changes to them require
  separately authorized work. Tests may use the existing runtime and loader.
- Run `bun check` and `bun test` in this package. Root-suite execution and timing
  benchmarks are not routine checks for this isolated slice.
- Keep conformance claims scoped to tested cases. Report missing host contexts,
  tooling, module-graph integration and delivery coverage rather than implying
  a complete language implementation.
