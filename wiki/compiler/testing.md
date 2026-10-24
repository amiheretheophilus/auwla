# Testing

**Folders:** `packages/compiler-next/tests/` (built), `features/*/*.test.ts` and
`optimize/*.test.ts` _(planned)_.

## Files

| File | What it does |
| --- | --- |
| `tests/reference/transform.ts` | Turns a module into a reference module: decides which bindings need a slot (built on `yuku-analyzer`, `yuku-ast`, `yuku-codegen`) |
| `tests/reference/runtime.ts` | Runs the reference: re-renders everything, keeps slots per component instance |
| `tests/reference/sources.ts` | Independent source state, readiness values, JSON fetches and promise reads |
| `tests/reference/readiness.ts` | Source-aware expressions, imports and module derivations |
| `tests/reference/preparation.ts` | Atomic initial preparation without DOM, shared position matching and active source collection |
| `tests/reference/reads.ts` | Dependency queries using yuku bindings and references |
| `tests/reference/callbacks.ts` | Detects function boundaries so callback creation does not read its captures |
| `tests/reference/closures.ts` | State in helper and factory closures: a dependency cell per invocation, recorded when a created function reads the binding |
| `tests/reference/ast.ts` | Shared yuku AST builders for the test transforms |
| `tests/harness/case.ts` | The `Case` and `Step` types, optional `check(container, observation)` assertions, and `defer(name)` for async cases |
| `tests/harness/run.ts` | `behaves(name, case)`: runs the case on the reference and on a compiler, compares after each step. An exception in an event handler fails the run (the DOM only reports it as a window `error` event). `disposeRuns()` cleans up after a failed run |
| `tests/harness/server-functions.ts` | Server function client modules, generated from `define.function` files by the framework's own generator |
| `tests/harness/compilers.ts` | The compilers a case can run on; `COMPILER=old` (default) is `packages/compiler` |
| `tests/harness/compile-worker.ts` | Optional separate-process old compilation for cases that can synchronously loop |
| `tests/harness/serialize.ts` | The visible DOM as a comparable string |
| `tests/harness/requests.ts` | Queued JSON responses/rejections and normalized request history |
| `tests/cases/<page>.test.ts` | One file per wiki page; holds that page's "Cases to test" |
| `tests/generator/program.ts` | fast-check arbitraries: a random program as plain data (state, derived values, views, buttons, clicks) |
| `tests/generator/print.ts` | Prints a program as `App.tsx` and its steps; checks it parses with `yuku-parser` |
| `tests/generator/generated.test.ts` | Runs random programs, shrinks a failure, reports it with a seed |
| `tests/generator/corpus.test.ts` | Runs every saved failure in `tests/corpus/` |
| `tests/generator/sources.test.ts` | Random programs with sources, checked without a compiler: answered late or inline from the start, they must end on the same page (`sources.md`) |

Run them with `bun test` in `packages/compiler-next` (no build needed), or one file:
`bun test cases/handlers`. Generated programs: `FC_RUNS=200 bun test generator`
(default 25), `FC_SEED=<seed>` to repeat a run, `SAVE_CORPUS=1` to keep the shrunk
failure. `COMPILER=next` runs the cases on compiler-next instead of the old
compiler (`plan.md` tracks how many pass). Unit tests of compiler stages live next
to the code (`src/**/*.test.ts`); `bun test src` runs only those.

`REFERENCE_ONLY=1 bun test cases` runs the reference without compiling. Use it to
develop the oracle, then run each new case in the default comparison mode before
calling the slice finished. That writes both `tests/out/<case>/reference/App.tsx`
and `tests/out/<case>/compiled/App.tsx` (plus any additional modules). A compiler
rejection is a recorded failure and cannot produce compiled output; runtime or
assertion failures still leave both versions available to inspect. Each case's
optional `check` runs after mount (observation 0) and after each step, on both
renderers in the default mode. The ported regressions use it to assert known text
and DOM identity independently of the comparison, so two wrong renderers cannot
agree unnoticed. On PowerShell, set `$env:REFERENCE_ONLY = '1'` before the command;
remove it with `Remove-Item Env:REFERENCE_ONLY` to restore comparisons.

Cases may provide extra `modules` for imports. Steps include `respond` (JSON body
and optional HTTP status), `rejectRequest`, and `reject` for a named `defer`.
`{ advance: ms }` lets time pass: a case with this step runs on Bun's fake timers
from before its modules load, so `setTimeout` and `setInterval` callbacks fire
only when a step advances the clock (the timer cases in `cases/callbacks.test.ts`).
The DOM preload keeps Bun's native timers, so fake timers work with happy-dom.
Each run owns and disposes its module work, sources and transport. Relative and
same-origin absolute request URLs compare by path and query. Use `--timeout 30000`
when this machine is busy; the default five-second per-case timeout can expire.

A case can set `compileTimeoutMs` to isolate old compilation with an OS-enforced
deadline. `COMPILER_TIMEOUT_MS` overrides it for a selected diagnostic run. This
handles synchronous compiler loops, which prevent Bun's test timer from firing.
A deadline is reported as failure; it never skips or passes a fixture. The
recursive JSX-helper case uses 15,000 ms. The child receives the same module text
and compile options as the ordinary adapter, and emits JSON only when compilation
finishes. This deadline is containment for debugging, not a performance benchmark.

## What it does

Checks that compiled output behaves like plain JavaScript, without listing every
JavaScript case by hand.

## The idea

The right answer comes from JavaScript itself: "every expression that we can see it
effect in the console means we need to see it on the ui" (`../rules.md`, rule 10).
So every test compares the compiled component with a **reference renderer** that is
deliberately simple and slow, implementing JavaScript and the user's agreed
reactivity rules.

**The old compiler does not define correctness.** It is a comparison target and a
performance baseline. Its failures expose bugs the rewrite must fix; they are
never expected failures for `compiler-next`. All valid-JavaScript cases, including
the 19 that currently fail on the old compiler, must pass on the new compiler.
The test reference can also contain bugs: when it disagrees with JavaScript or an
agreed rule, fix the reference rather than copying its mistake into the compiler.

The memo slice adds six comparisons in `cases/memos.test.ts` and direct native
execution checks in `src/features/derived/dom.test.ts`. Shared-builder cases caught
a feedback loop in the reference: co-written outputs must be internal to the
computation, with input snapshots captured after the statement finishes. The
reference transform/runtime were corrected with those expectations unchanged;
details and current compiler boundaries are on `state-and-derived.md`.

Stored JSX exposed another reference setup bug: a settling render repeated a new
initializer after a later body assignment changed its input. `finishSetup` seeds
only newly created memo snapshots at the end of the component body, before refs
and effects. The explicit creation-time-value assertion remains unchanged.
The five affected reference files pass 200 cases. The scoped conditional generator
passes 200 programs with seed 20261021 after stored-value support. The unchanged
full generator still fails on lists; its nonempty-list regression is preserved as
`tests/corpus/generated-20261023.json` for Phase 5.

## Layers

1. **Reference renderer** (`tests/reference/`). Test-only: the framework never
   renders this way. After every step it calls every component again. The component
   body is setup code, so only derivations are computed again:
   - every `let x` / `const x` is a `memo`: computed again when a deep copy of
     its inputs changes, together with the body statements that build it (with no
     inputs it is computed once), until an actual later assignment takes control;
   - a prop captured or reassigned by a callback has a live `prop` slot;
   - destructured aliases follow the same rule, with one native pattern
     evaluation per changed input;
   - every other body statement is setup and runs once, after its inputs are ready.

   A statement that calls something with a value (`x.anything()`, `f(x)`) runs inside
   `$ctx.observe`, which deep-copies the value before and compares it after. The
   reference uses no method list: it sees what really happened. If the statement
   changed the value, it builds it from then on.

   Actual synchronous callback reads and writes are recorded by the reference
   slots. This discovers immediate callback dependencies without a host API name
   list. Module reads remain native live bindings, recorded through `$captureRead`;
   native assignment targets preserve logical assignment and postfix results.
   Readiness is checked when a body callback is invoked, not when it is stored.
   `cases/callbacks.test.ts` owns the callback regression cases; their rules and
   old-compiler failures live on `state-and-derived.md`.

   DOM nodes are kept between renders, matched by authored JSX site, position, key
   and tag, so refs,
   typed text and focus survive; each render updates their props and order. After
   that, refs are installed and effects run, and the app renders again until nothing
   changes. Component calls are matched to their instance the same way.

   Separate JSX branches own separate nodes even when their tags match. A key on
   a returned root also participates in matching. Unchanged authored children leave
   imperative DOM work intact. Effects compare inputs after refs mount and save
   them after their synchronous writes, so they do not immediately re-trigger
   themselves. Removing an effect also schedules another pass for cleanup writes.
   Creating/discarding a prepared component or tearing down a ref also schedules
   another pass, so setup/cleanup writes reach earlier readers even when the
   visible pending fallback stays identical.
   Ten passes without settling is an error, never a silently accepted result.
   The harness disposes apps and removes DOM even after a failed assertion or a
   failed compiled mount.

   That is `state-and-derived.md`, `refs.md` and `effects.md`, executable.

   Sources, ordinary `Group` policies and the first atomic `suspend` lifecycle
   cases now have an independently asserted baseline (`sources.md`). That page
   lists verified cases and remaining gaps. Routing and SSR are not modeled. JSX and TypeScript
   are lowered by Bun's transpiler, because `yuku-codegen` drops `enum` instead of
   converting it.
2. **Comparison tests.** A case is a component and a list of events. After the first
   render and after each event, the compiled DOM must equal the reference DOM.
3. **Generated programs.** `fast-check` builds random components from JavaScript
   building blocks: literals, operators, aliasing, closures, destructuring, method
   calls, mutation, control flow, async, JSX shapes. A failure shrinks to the
   smallest program that still fails. That program is saved to `tests/corpus/` and
   runs in every later run.
4. **Feature tests** next to each feature, for its graph and plan facts.
5. **Optimizations on and off** _(planned for compiler-next)_. Each comparison
   will run twice; both runs must match the reference (`optimize.md`).
6. **Strict checks.** A compile error on valid input already fails a case. Explicit
   checks for newly introduced `try`/`catch`/`finally` and output parsing with
   `yuku-parser` are still planned for the compiler adapter. Imported output
   currently has to parse through Bun to run.
7. **Acceptance.** The old suites (root `tests/`, package tests, Vite, the Conduit
   flows) run against `compiler-next` through a switch. When they all pass, the old
   compiler is deleted.

The first cases are the **Cases to test** section of each concept page, written in
`tests/cases/<page>.test.ts`. Each one is a case the old compiler rejects or shows
wrong, or behaviour it must keep. The earlier 83-case comparison (`9d98d41`) gave
64 pass and 19 fail on the old compiler, each failure a bug listed on its page. Those 83 cases
run on the reference; its explicit text and node-identity checks pass. The 33 added
cases port the root regressions for written values, derived literals, prop writes,
visible effects, keys and reactive refs (existing cases cover overlapping forms).
The source slice adds 27 cases (`sources.md`), with 18 passing and 9 failing on
the old compiler; an async-helper regression also checks that `return await`
remains valid. These are separate from the earlier 83-case comparison above.
The atomic slice adds 14 cases: 8 pass and 6 fail on the old compiler, with both
generated versions available for every case. Eleven further atomic lifecycle
cases compare branch discovery, keyed drafts, nested/shared error policies,
module ownership, remounting and failed-input recovery: 6 pass and 5 fail on the old compiler.
The keyed-draft assertion first exposed a reference settling bug; it passes after
the fix and then exposes a missing setup write notification in the old output.
Four recovery assertions also caught stale failure retention in the reference;
they pass after the fix and expose corresponding failures in the old compiler.
The mixed class/state/JSX slice adds twenty cases: fourteen on
`state-and-derived.md` (old compiler: thirteen pass, one fails) and six on
`components.md` (three pass, three fail). Every case has explicit assertions;
nineteen have both generated versions and one is rejected by the old compiler.
Reference snapshots inspect data descriptors without invoking unused getters,
and track static and symbol-backed data. The assertions first caught three
reference gaps, then exposed the old compiler's four failures.
Nineteen further spread/rest/tag/recursion cases add exact array/object copy
mutations, shallow aliases, rest declarations/parameters/props, JSX spread children,
native/member/factory tags, and recursive components/helpers. The old compiler
passes five and fails fourteen (including one bounded compilation timeout).
Thirteen have paired output; five reject before emit and one times out. The
reference's two component identity/classification bugs were fixed without changing
the assertions. A review added the `$fetch(null)` case, four source
destructuring cases and five cases of sources inside ordinary JavaScript
(`sources.md`). All 185 reference cases pass; package `bun check` passes for 25 files. This is
still reference development, not permission to start the compiler.
The old compiler has about 305 distinct `memo-dom:` messages. Most are internal
invariants or contracts of the framework's own APIs (`route-to`, `$routed`, `Group`,
`page()`, `mount()`, server functions); those stay. Only messages that reject
ordinary JavaScript become cases.

The 2026-10-20 callback decision is verified by 22 explicit callback cases, all
passing on the reference and failing on the old compiler, with paired output for
each. Exact differences and remaining coverage live on `state-and-derived.md`.
All 219 current reference cases pass, with a clean package type check (42 files).
The 200 generated source programs also passed during this slice.

## Running

Phase 3 also runs `tests/generator/state.test.ts`: it uses the original program
generator, filtering only views to text/adjacent text. Numbers, arrays, objects,
derivations, builders, actions and clicks remain generated. **200 programs pass
with seed 20261021.** This is separate coverage, not a pass of the full generator.
The unchanged `tests/generator/generated.test.ts` first failed on JSX inside a
conditional (`tests/corpus/generated-20261021.json`), now passing after the
expression-conditional slice. A rerun with seed 20261022 stops on a Phase 5 list
expression, saved as `tests/corpus/generated-20261022.json`. Preserve both programs
and all expectations; the full generator has not passed.
By the user-approved phase ordering, 200 full-generator programs are required
after conditional/list support at the Phase 5 exit.

Phase 4 adds `tests/generator/conditionals.test.ts`, using the unchanged program
generator with only list views filtered out. It retains text, adjacent, ternary
and logical JSX views and all state/actions. **200 programs pass with seed
20261021.** This run found a resolver bug: assignment RHS members were incorrectly
recorded as property writes, merging unrelated replay groups. The minimized
program is `tests/corpus/conditional-state-20261021.json` and passes unchanged
after the fix. This scoped run does not replace the Phase 5 full-generator gate.

- Tests import `src` directly. No build is needed before running them.
- Run `bun check` in `packages/compiler-next`, rather than at the repository root,
  where unrelated generated example output is included.
- `bun run test:changed` _(planned)_ maps `git diff` to feature folders and runs only
  their tests, plus a small generated batch. A change in `core/` runs everything,
  but on CI. Features never import each other, so the mapping can be trusted.
- The local generated budget is small, for a slow machine. CI runs a large one.

### Where tests run

**The local machine first.** CI is only for a batch that is slow on the
development machine: one that takes seconds to minutes, not milliseconds.

| Run locally, on every change | Time here | 
| --- | --- |
| `bun check` in `packages/compiler-next` | ~1 s |
| the unit tests of the touched feature (`bun test src/features/<name>`, `src/core/<stage>`) | seconds |
| the case files the change affects (`COMPILER=next bun test tests/cases/<file>`), and with `REFERENCE_ONLY=1` when the reference changed | seconds to ~1 min each |
| runtime tests a runtime change affects (`bun test ./packages/runtime/tests/<file>`) | seconds |

| Run on CI, by hand, when needed | Time here | On CI |
| --- | --- | --- |
| every case on compiler-next, through the phase gate | ~10 min | ~30 s |
| every case on the reference | ~5 min | ~20 s |
| the generators at 200 programs | ~5 min | ~45 s |
| all unit and runtime tests at once | ~1 min | ~15 s |

Reach for CI when one of these is due: at a phase exit, after a change to shared
machinery (the reference oracle, the graph, the derived-value planner, the
runtime), or before reporting a step as verified across the suite. Not after
every edit.

The workflow is `.github/workflows/compiler-next.yml`. It never runs on push;
start it by hand, choosing a suite (`all`, `cases`, `reference`, `generators`,
`unit`):

```sh
gh workflow run compiler-next.yml --ref compiler-rewrite -f suite=cases
gh run list --repo amiheretheophilus/auwla --workflow compiler-next.yml --limit 1
gh run watch <id> --repo amiheretheophilus/auwla --exit-status
```

The `cases` job keeps its log as an artifact for 3 days
(`gh run download <id> -n cases-log`). The repository is public, so standard
GitHub-hosted runners are not billed; running by hand still keeps CI for the
checks that need it.

`scripts/phase-gate.ts` applies the rule of `plan.md`, "How progress is measured":
a case may fail on compiler-next only with a "from Phase N" error. It prints the
pass and fail counts, and how many cases wait for each phase.

CI also catches what the local machine can hide. On 2026-10-24 a compiled case
loaded locally only because a stray React install resolved leftover JSX; on CI it
failed to load. The pipeline now refuses to emit JSX at all.
- **Performance** uses `bench/`, not CI:
  1. A local run checks that the benchmarks pass their correctness gates. Local
     timings are noisy and are not compared.
  2. The user then runs `bench/` on a different machine. Those numbers are the ones
     compared against the baseline below.

## Performance baseline

The last full benchmark of the old compiler is `d6e678b`: 8 CPUs and 8 GiB on an
AMD EPYC VM, Chrome Headless Shell 149. `compiler-next` must beat it on the same
benchmarks (`../decisions.md`, 2026-10-19):

- **Octane** (ten frameworks, canonical and keyed reorder): overall average rank
  3.146, second after ripple (1.667), ahead of Solid (3.854).
- **js-framework**, ms: run 4.9, replace 9.3, update 0.4, select 0.1, swap 0.6,
  runlots 43.7, clear 50.1.
- **The `bun run bench` DOM matrices** (module, component and mixed state; mutable
  and immutable updates).
- **Compiled third-party runtime:**
  - zero idle renders;
  - 128 update renders for 128 writes in the local and fetch cases;
  - the shared case records 16,384 update renders for 128 writes. That is a known
    precision gap, for `optimize/reason-routing.ts`.

