# Prototype status

Updated: 2026-11-11. Branch: `prototype/jsx-plus`.

## Current slice

**P3-CACHE and P3-EXAMPLES: bounded mapper reuse and a real task board built.**
The user requested more actual authoring code rather than only small test sources.
Start with [the examples guide](../packages/jsx-plus/examples/README.md) and
`packages/jsx-plus/examples/task-board/App.auwla`.

The authored app includes types, ordinary state/derived variables, form handlers,
search/status filters, ref focus, direct `if`, `.map()` rows and template
interpolation. `main.ts`, HTML/CSS and a small Bun preview loader make it runnable
locally. The preview builds once; restart after editing. It demonstrates one UI
module, not production Vite, HMR or general multi-module loading.

`src/mapper/project.ts` keeps one latest exact filename/content result per project.
`server.ts` creates fresh independent instances on every open/reopen and drops
them on close. Edits/file switches recompute; the cache retains no AST or edit
history. [Cache evidence](mapper-cache.md) uses the actual task-board source and
real projector. Existing 34-case [flow checking](checking-flow.md) stays intact.
Compiler-next, runtime and the language grammar are unchanged in this slice.

## Baseline and evidence

This slice started from clean baseline `a35db526`. Results cover the mapper cache,
actual example files/preview, direct review and documentation in this commit.

- JSX+ `bun check`: no errors in 201 files.
- JSX+ `bun test`: **121 passed, 0 failed, 684 assertions**, nine files.
  Covers extended parsing/execution, actual CLI/LSP diagnostics, applied ref/state
  renames, projection coverage, generated spans and lowering fallback.
  Includes all 34 actual LSP flow targets, actual CLI/ref/state rename paths,
  cache tests and task-board interactions in both compiler modes: status/search
  filtering, submit/trim/clear/focus, toggle/remove, empty state and interpolation.
- Real-example cache sequence: **7 requests, 5 projections, 2 exact-repeat hits**.
  Additional assertions cover parse-error reuse/restoration and independent lifetimes.
- Native TypeScript CLI checks `examples/task-board/tsconfig.json`, including
  `App.auwla` and `main.ts`, with `--runExternalCode`: exit zero. The package CLI
  integration also runs this configuration rather than merely testing a projection.
- `bun run examples/task-board/preview.ts --build`: succeeds using the current
  browser runtime source. HTTP smoke check: HTML, JavaScript and CSS return 200
  with appropriate content types; unknown path returns 404. The process was stopped.
- Direct review covers the complete cached result, exact input keys, one-entry
  bound, fresh configuration lifetime, closed-handle cleanup, example loader
  ownership and copied-source behavior. No sub-agents, following user direction.
- Documentation audit: 28 documents, 191 local links/heading targets and 46
  mapped package paths passed. `git diff --check` passed.
- Full root suite, timing benchmarks, SSR/adoption and IDE activation were not
  run. No general performance claim follows from these checks.

Find the slice's commit with `git log -1 -- packages/jsx-plus/src/mapper/project.ts`.
The language spec remains draft 0.1 revision 1; no grammar revision is needed.

## Next

P3-EDITING: use real task-board edits to establish completion-edit fidelity and
recovery boundaries. Syntax errors must remain authored errors; reusing an older
successful projection must never hide the current malformed input.

Broader contextual typing, primary hover/completion flow accuracy, complete replay
proofs, uninitialized/destructured seeds, nested/compound body assignments,
module-level state, live imports, lowering maps and multi-module editing remain open.

The current fallback keeps ordinary TSX checking for unsupported/lowered input;
it does not fix reactive flow there. Incremental parsing, measured heap/latency,
parser recovery and repeated-suffix parsing need separate evidence. See [plan.md](plan.md),
[tooling.md](tooling.md) and [syntax.md](syntax.md).

## Other boundaries

- Existing refs, reactivity, lists and ownership remain compiler-next/runtime work.
- Backend `.auwla` configuration/loading is planned; that code is ordinary
  nonreactive backend code. Isomorphic support comes later.
- Multi-module production loading, Vite, IDE registration, delivery and final
  JavaScript debugging maps are not established by this slice.
- The rewrite's acceptance/performance gates remain in [wiki/status.md](../wiki/status.md).
