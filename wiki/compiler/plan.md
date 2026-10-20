# Plan: building compiler-next

The order of work for the new compiler, from an empty `src/` to replacing
`packages/compiler`. A session that picks this up reads `../../AGENTS.md`,
`../README.md`, then this page, and continues at the first unchecked step.

## Rules for every session

- **Do the next unchecked step.** Do not start a later phase before the current
  phase's exit check passes. Do not skip ahead to optimizations.
- **Semantics are decided.** `../rules.md`, `../decisions.md` and the concept pages
  say what correct is; the tests in `packages/compiler-next/tests/` are the spec.
  Do not change a rule or a test expectation without the user. If a case seems
  wrong, record why in `../open-issues.md` and ask.
- **A failing case is never accepted as expected.** Old-compiler failures must pass
  on compiler-next.
- **Structure first** (`README.md`): one graph decides what each binding is;
  features depend only on `core/`; `pipeline.ts` alone orders stages; the authored
  AST is never edited; no `try`/`catch`/`finally` in output; anything not proven is
  `Opaque`, never an error (except framework API contracts, `sources.md`).
- **Readable code**: one step per line, named helpers, comments that say why.
- **After each step:** `bun check` in `packages/compiler-next`, run the affected
  cases, tick the box here, update the concept page and `../status.md`, commit and
  push to `origin` (`../../AGENTS.md`).
- **Performance:** `bench/` locally only checks correctness gates; the user times
  it on another machine. Phase exits that name a benchmark need the user's numbers.

## How progress is measured

`COMPILER=next bun test cases` runs every case on compiler-next (Phase 1 adds the
switch). Record the pass count in `../status.md` after each step. Generated programs
run with `COMPILER=next FC_RUNS=200 bun test generator`. Each phase lists the case
files that must pass in full at its exit.

## Phase 0: decide the output

- [ ] The user approves the output architecture in `output.md`, or picks another.
  Record it in `../decisions.md`.

## Phase 1: skeleton and harness

- [ ] `src/index.ts` exports `compileModules(files, options)` with the same signature
  and options as `packages/compiler/src/linker.ts`, so the harness and later the
  Vite plugin can switch without changes.
- [ ] `src/pipeline.ts` calls the stages in order; each stage is a function from
  the previous result to its own (`core.md`).
- [ ] `src/core/parse/`: source text and language → yuku AST, diagnostics as errors.
- [ ] `src/core/resolve/`: on `yuku-analyzer`. Per binding: declaration, reads,
  writes, and for each write whether it runs later (handler, effect, callback,
  timer) or in the body; imports and exports. Unit tests in `src/core/resolve/`.
- [ ] `tests/harness/compilers.ts`: add `next`, selected with `COMPILER=next`.
- **Exit:** a module with no JSX compiles and runs unchanged; `bun check` passes.

## Phase 2: the graph

- [ ] `src/core/graph/`: node kinds `Constant`, `State`, `Derived`, `Prop`, `Source`,
  `Ref`, `Opaque`, with `reads` edges and `pending(n)` (`core.md`).
- [ ] `src/features/state/`, `derived/`, `props/` classify bindings by the table in
  `state-and-derived.md`, including body statements that build a value (`if`,
  `switch`, loops) and calls that may change one.
- [ ] Graph tests next to each feature: one per row of the classification table
  and per rule bullet on `state-and-derived.md`.
- **Exit:** the graph classifies every binding in every case source as the
  reference does (a test can compare against `tests/reference/transform.ts`'s
  slot choice).

## Phase 3: first slice, end to end (static markup, state, text, handlers)

- [ ] Design step: the emitted shape for state, memos and handlers per `output.md`,
  including where versions live. Write it on `output.md` before coding.
- [ ] `src/core/plan/`: `Template`, `TextSite`, `AttributeSite`, `PropertySite`,
  `EventSite`.
- [ ] `src/core/emit/` + `src/features/*/dom.ts`: DOM backend on
  `@memoized-dom/runtime`, built with `yuku-ast` builders, printed by `yuku-codegen`.
- [ ] Handlers: writes, updates, `await` in handlers (UI updates before each await,
  `handlers.md`), member and call handlers.
- **Exit:** `cases/state-and-derived`, `cases/handlers` and `cases/core` pass on
  `COMPILER=next`, except cases needing later phases (lists, components), which
  are listed in `../status.md`. The plain generator passes 200 programs.

## Phase 4: conditionals

- [ ] `Conditional` regions: `?:`, `&&`, `??`, early returns, body `switch` and
  `if` assigning JSX (`conditionals-and-lists.md`).
- **Exit:** the conditional cases in `cases/conditionals-and-lists` pass.

## Phase 5: lists

- [ ] The general rule: any child value that is an array is a list, keyed or by
  position; `map` with all three arguments, call results, JSX pushed in loops,
  spread children.
- [ ] Then the fast paths in `optimize/` (`optimize.md`): keyed `map`, targeted
  `push`/`splice`/`sort`, DOM-only rows, selection. Each runs with optimizations
  on and off; both must match the reference.
- **Exit:** `cases/conditionals-and-lists` passes in full. `bench/dom` and the
  js-framework app pass their correctness gates locally; the user times them
  against `d6e678b` (`testing.md`). No regression is accepted.

## Phase 6: components

- [ ] `ComponentCall` with props as one object, children and slots, member and
  dynamic tags, factories, recursion, prop overrides (`components.md`).
- **Exit:** `cases/components` passes; Octane run by the user.

## Phase 7: effects, cleanup, refs

- [ ] `$effect`, `$cleanup`, module effects, `x++` as a write, an effect's own
  writes not re-running it (`effects.md`); reactive refs (`refs.md`).
- **Exit:** `cases/effects` and `cases/refs` pass.

## Phase 8: sources and Group

- [ ] `$fetch`, `$read`, `$track`, GET server functions; readiness (`pending`),
  `Group` policies, `suspend`; the non-GET contract check and its compiler tests
  (`sources.md`).
- **Exit:** `cases/sources` passes; the generated source programs also run
  against compiler-next.

## Phase 9: linking and packages

- [ ] Cross-module facts (`linking.md`): imported state, derivations and
  components; third-party package compilation.
- **Exit:** multi-module cases pass; `bench/linker` and `bench/package-compilation`
  gates pass.

## Phase 10: SSR, hydration, routing, acceptance

- [ ] SSR and HTML backends from the same plan; hydration; routing (`$routed`,
  `page()`).
- [ ] Acceptance (`testing.md`, layer 7): the root `tests/`, package tests, the
  Vite suite and the Conduit flows run against compiler-next through a switch.
- [ ] The user runs the full benchmark on the VM; every number at least matches
  `d6e678b`.
- **Exit:** all suites pass, then `packages/compiler` is deleted and compiler-next
  takes its name.

## Later

- CI on GitHub Actions on `amiheretheophilus/auwla` once the suite reaches
  thousands of cases.
- The auwla rename across all packages.
