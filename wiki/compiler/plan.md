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

Every case that fails must fail with a "from Phase N" error that names the phase
that builds the feature. A failure without one is a bug, even in an unfinished
phase: the output was wrong and nothing said so. The checks are in
`core/plan/template.ts` (`unsupported`), `core/plan/later-phases.ts` (`$effect`,
`$cleanup`, imports from `@memoized-dom/data`) and the runtime value slot (an
array child). Remove each check when its phase is built.

## Phase 0: decide the output

- [x] The user approves the output architecture in `output.md`, or picks another.
  Record it in `../decisions.md`. Done 2026-10-20: the old runtime model with
  version-checked memos; no signals.

## Phase 1: skeleton and harness

- [x] `src/index.ts` exports `compileModules(files, options)` with the same signature
  and options as `packages/compiler/src/linker.ts`, so the harness and later the
  Vite plugin can switch without changes. Options so far: `runtimePath`,
  `resolveImport` (`src/options.ts`); the others arrive with their phase, and
  unknown ones are ignored.
- [x] `src/pipeline.ts` calls the stages in order; each stage is a function from
  the previous result to its own (`core.md`).
- [x] `src/core/parse/`: source text and language → yuku AST, diagnostics as errors.
  Also lowers `enum` and parameter properties.
- [x] `src/core/resolve/`: on `yuku-analyzer`. Per binding, **at any scope**
  (component, module, helper, factory closure, class): declaration, reads, writes
  including member writes and mutating calls attributed to their root binding,
  and for each write whether it runs later (handler, effect, callback, timer) or
  in the body; imports and exports. Unit tests in `src/core/resolve/`.
- [x] `tests/harness/compilers.ts`: add `next`, selected with `COMPILER=next`.
- **Exit:** a module with no JSX compiles and runs unchanged; `bun check` passes.
  Passed 2026-10-20: `src/pipeline.test.ts` (an enum, a class with parameter
  properties, imports between modules). Unit tests live next to the code in
  `src/`, so `bunfig.toml`'s test root is the package.

## Phase 2: the graph

- [x] Verify the reference tests for the 2026-10-20 callback decision
  (`state-and-derived.md`, "Callbacks"). 22 callback cases and all 219 reference
  cases pass; the old compiler fails all 22 callback cases. Values derive until
  an actual later reassignment; immediate callback invocations can build a
  derivation. Resolve's lexical `later` flag is not a semantic classification.

- [x] `src/core/graph/`: node kinds `Constant`, `State`, `Derived`, `Prop`, `Source`,
  `Ref`, `Opaque`, with `reads` edges and `pending(n)` (`core.md`).
  Built as the shared graph layer, with 19 tests. Accepts feature facts and keeps
  execution owners and write sites separately from initial computations. The
  next step supplies classification and connects it to `pipeline.ts`.
- [x] `src/features/state/`, `derived/`, `props/` classify bindings by the table in
  `state-and-derived.md`, including body statements that build a value (`if`,
  `switch`, loops) and calls that may change one. State lives anywhere
  (`output.md`, "State lives anywhere"): module scope, closures in helpers and
  factories, class fields, objects reached from any binding. Function summaries
  record which state a call writes, so `store.inc()` is a write of `store`.
  Done 2026-10-21 and wired into `pipeline.ts`. Globals the program never writes
  are not inputs; imports take their definition's kind; possible builders are
  decided at runtime. Still open: mapping `this` writes in a method to the
  receiver's fields (the call is already a write of the receiver).
- [x] Graph tests next to each feature: one per row of the classification table
  and per rule bullet on `state-and-derived.md`. Most exist (`features/*/classify.test.ts`,
  `core/graph/size.test.ts`); audited 2026-10-21. The state tests now explicitly
  cover every let/const, literal/reactive, later-write/no-write combination.
  The mapping of rule bullets to tests is on `state-and-derived.md`.
- **Exit:** the graph records each binding's initial computation and the writes
  that can take control at runtime. A nested write never makes the initial value
  a snapshot. Verify classifications and transition sites against the behavior
  cases; reference slot allocation alone is not a semantic classification.

## Phase 3: first slice, end to end (static markup, state, text, handlers)

- [x] Design step: the emitted shape for state, memos and handlers per `output.md`,
  including where versions live for each row of its "State lives anywhere" table.
  Write it on `output.md` before coding. Module state, factory closures and
  class instances are in this slice, not later: the `complex state:` cases on
  `state-and-derived.md` belong to its exit.
  Done 2026-10-21: `output.md`, "Phase 3 design". Unknown calls are never re-run
  because the owner updated; escaping functions report hidden reads; possible
  builders are observed on their first run.
- [x] Graph: find escaping functions and the reactive bindings each reads
  (`output.md`, "Phase 3 design", rule 5), with unit tests. Done 2026-10-21:
  `core/resolve/escapes.ts`, `core/graph/escaping.ts`, 8 tests. A method using
  `this` is kept with `receiver: true` for the classes slice.
- Build in slices, each proved by its cases on `COMPILER=next`, with the pass
  count recorded in `../status.md`:
  - [x] static markup (templates). Built on the existing uncommitted plan/template
    files: 18 behavior cases pass on `COMPILER=next`, plus 10 plan/pipeline checks.
  - [x] state, text and handler writes (counters). Local assignment versions,
    per-site update checks and batched write commits. Nine focused counter cases
    pass on `COMPILER=next`, plus the existing counter, enum, typing and promise
    callback cases. Native execution and runtime tests are listed in `handlers.md`.
  - [x] versioned local memos and definite body builders. Component-body
    declarations/patterns, source-ordered shared statements, output versions and
    native const write errors. Six focused comparisons, four existing behavior
    cases, ten execution tests and three plan tests pass. Possible builders join
    the mutation-observation slice. Nested-block storage now uses lexical
    activations, with seven native cases plus caught-setup recovery verified
    (`state-and-derived.md`).
  - [x] local takeover flags and runtime setup/replay ownership. Twelve selected
    `cases/callbacks` comparisons and the existing handler-takeover case pass;
    eight native execution tests and four runtime scope tests cover partial
    stores, sibling replay, nested owners and exception boundaries. Module/closure
    takeover and possible builders follow their storage/observation slices;
    synchronous caught-nested-setup recovery is now verified by five execution
    cases, including catch-pattern defaults and nested finally/rethrow paths.
  - [x] mutation commits and the unknown-call check. Direct property assignment,
    update, delete, native pattern/loop targets, call observation, aliases and
    possible builders are built for component storage. Receiver/private-field
    writes and shared roots are built too. Descriptor/prototype edits pass a native
    regression without invoking unused getters. Hostile proxy reflection remains
    a known conformance gap on `handlers.md`, not an accepted failure.
  - [x] escaping-function tracking (the `unknown callers:` cases). Component-local
    hidden reads, opaque initializer/site dependencies and dynamic memo edges
    are built; factory/module/class versions and subscriptions are built too.
    The prop-getter comparison needs Phase 6 components.
  - [x] module state, imports, factory closures and classes (`complex state:`).
    Native versions/readers, shared memo replay/takeover, reexports and receiver
    stores are built. Focused cases and all 52 supported exit comparisons pass;
    the 17 list/component exceptions are listed in `../status.md`.
  - [x] `await` in handlers. Native suspension boundaries flush pending local and
    shared writes after operand evaluation. Five immediate-boundary execution
    checks, all six handler comparisons and nine runtime batching checks pass.
- [x] `src/core/plan/`: `Template`, `TextSite`, `AttributeSite`, `PropertySite`,
  `EventSite`.
- [x] `src/core/emit/` + `src/features/*/dom.ts`: DOM backend on
  `@memoized-dom/runtime`, built with `yuku-ast` builders, printed by `yuku-codegen`.
  The module/template and Phase 3 feature emitters are built.
- [x] Handlers: writes, updates, `await` in handlers (UI updates before each await,
  `handlers.md`), member and call handlers.
- **Exit:** `cases/state-and-derived`, `cases/handlers` and `cases/core` pass on
  `COMPILER=next`, except cases needing later phases (lists, components), which
  are listed in `../status.md`. The text-view state generator
  (`tests/generator/state.test.ts`) passes 200 programs. The unchanged full
  generator also generates conditional/list views: preserve its failures and
  require its 200-program pass at the Phase 5 exit, after those features exist
  (user-approved gate ordering, 2026-10-21). Passed 2026-10-21: 52 supported
  comparisons and 200 text-view programs. Known conformance gaps stay on their
  concept pages; no failing assertion or saved program is treated as a pass.

## Phase 4: conditionals

- [x] Conditional expression regions: `?:`, `&&`, `||`, `??` with ordinary
  left operands. Retained branch templates/sites, lazy selectors, primitive
  fallbacks, nested/fragment roots, SVG namespaces and disposal are built.
- [x] Bare expression/arrow returns and return-only if/else tails. Setup state
  survives branch swaps; a common fallthrough branch retains its identity.
- [x] Stored/assigned JSX, helper-returned values, JSX on logical left operands,
  and body `switch`/`if` assigning JSX (`conditionals-and-lists.md`). Native capture
  order, retained templates, independent consumers and HTML/SVG destinations are
  verified. The rewrite's dense planner/emitter/runtime helpers were expanded and
  documented before continuing feature work, at the user's request.
- [x] General early returns with interleaved setup, and switch returns. Done
  2026-10-24: a selector program (`conditionals-and-lists.md`, "Early returns"),
  six new comparison cases and two plan tests.
- **Exit:** the conditional cases in `cases/conditionals-and-lists` pass. Passed
  2026-10-24: all 12 `conditional:` cases pass on `COMPILER=next`. An audit the
  same day added eighteen more and fixed the two bugs they found
  (`conditionals-and-lists.md`, "Early returns"); all 30 pass.

## Phase 5: lists

- [x] The general rule: any child value that is an array is a list, keyed or by
  position; `map` with all three arguments, call results, JSX pushed in loops,
  spread children. Done 2026-10-24 (`759c689`): every list case not needing
  components passes, and the full plain generator passes 200 programs on two
  random seeds, including the saved list failures in `tests/corpus/`.
- [ ] Then the fast paths in `optimize/` (`optimize.md`): keyed `map`, targeted
  `push`/`splice`/`sort`, DOM-only rows, selection. Each runs with optimizations
  on and off; both must match the reference. Also found in the Phase 6 review:
  a render's `data.map(...)` is observed as an opaque call, which snapshots every
  object reachable from `data` on each evaluation (1,000 rows: 1,000 snapshots);
  Avoiding that observation requires a callee/receiver/effect proof, never a
  method-name rule. Even native `map` callbacks or array accessors can mutate
  state, and overridden methods can do anything. Preserve opaque observation
  whenever those effects are unproven (`optimize.md`).
  The optional plan stage and on/off comparison harness are built. The first
  pass retains private row matching tables, including exact duplicate teardown
  order and exception/reentry recovery. It preserves native callbacks and opaque
  observation; direct iteration lowering, capture removal and selection routing
  remain pending. Work counts and proof limits are in `optimize.md`.
  A host with spread attributes (`<div {...p}>`) takes the generic runtime path
  and gets no template. An outside review of the inline-row output
  (2026-10-25) lists what the old compiler's list path does and the general
  path does not, each measured by `bench/dom`:
  - a keyed `map` becomes a list region reconciled from `data` directly: no
    array of render values, capture tuples or row closures on each update;
  - a selection (`selected === item.id` in a row) refreshes the previous and
    the new key only, not every row;
  - a row's handler is stable or delegated to the list's parent, so an update
    never removes and re-adds 1,000 listeners;
  - adjacent text (`{item.id}: {item.label}`) is one text node, and a primitive
    text site writes `setTextData` without a value slot.
  **Done after Phase 6**
  (`../decisions.md`, 2026-10-24): the benchmark needs both the inline-row and the
  component-row apps, and the second needs components.
- **Exit:** `cases/conditionals-and-lists` passes in full. `bench/dom` and the
  js-framework app pass their correctness gates locally; the user times them
  against `d6e678b` (`testing.md`). No regression is accepted.
  The unchanged full plain generator passes 200 programs, including every saved
  conditional/list failure in `tests/corpus/`.

## Phase 6: components

- [x] `ComponentCall` with props as one object, children and slots, member and
  dynamic tags, factories, recursion, prop overrides (`components.md`).
  General path built and checked against component/state comparisons, independent
  native regressions and unchanged benchmark fixtures. These checks establish
  their covered cases, not all component behavior; details in `../status.md`.
- [x] A component used for its value (`items.map(Row)`, `const view = Row(x)`)
  returns markup, as the reference's does.
  Adapters are built; direct arguments, imported calls, map arguments/defaults/
  rest and discarded setup are locally checked. The Phase 6 guard is removed.
- [x] Review fixes (2026-10-25). A child updates only when a prop changed or a
  compiled edit reached it (`mutatedSince`); before, every parent update re-ran
  every child. A shared write wakes readers of what it wrote and of derived
  bindings, not of all the module's state. `defineComponent` no longer runs at
  every tag evaluation. The tag-name SVG restriction from that review was
  removed: a consumed value takes its destination namespace, including custom
  tags (`components.md`).
  `features/components/bench.test.ts` asserts the update counts on the
  component-row app: `update` 101 (100 rows and the list), `swap`, `remove` and
  `append1k` 1, a selection one per row.
- [x] Boundary audit after the supplied benchmark report: failed mounts dispose
  their collectors and children; initial rendering settles child writes;
  enumerable symbol props and rest-key order remain observable; finished
  observations release their payloads before queued recovery. Recovery preserves
  partial edits on exceptions and runs in the owning application. Tests and
  limitations stay on the relevant concept pages.
- **Exit:** component correctness and the performance floor both matter. The
  correctness audit also includes the 2026-10-26 helper-proof regressions:
  named callbacks and native index coercions must match the reference with
  optimizations enabled and disabled (`optimize.md`, "Read-only helpers").
  Fix these boundaries before further performance changes (`../decisions.md`).
  The user's report at `874c826` passes benchmark correctness gates, but the old
  compiler is faster on all 24 Octane operations and the DOM update-style run
  ends in an OOM. The performance gate is unmet (`testing.md`). Phase 5's pending
  fast paths and new measurements remain before moving to Phase 7. The audit's
  retention fixes do not establish the cause or resolution of that OOM.

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
- [ ] Lower a runtime TypeScript `namespace` and `export =` (`core.md`, parse).
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
