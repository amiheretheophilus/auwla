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
| `tests/reference/reads.ts` | Dependency queries using yuku bindings and references |
| `tests/reference/ast.ts` | Shared yuku AST builders for the test transforms |
| `tests/harness/case.ts` | The `Case` and `Step` types, optional `check(container, observation)` assertions, and `defer(name)` for async cases |
| `tests/harness/run.ts` | `behaves(name, case)`: runs the case on the reference and on a compiler, compares after each step |
| `tests/harness/compilers.ts` | The compilers a case can run on; `COMPILER=old` (default) is `packages/compiler` |
| `tests/harness/serialize.ts` | The visible DOM as a comparable string |
| `tests/harness/requests.ts` | Queued JSON responses/rejections and normalized request history |
| `tests/cases/<page>.test.ts` | One file per wiki page; holds that page's "Cases to test" |
| `tests/generator/program.ts` | fast-check arbitraries: a random program as plain data (state, derived values, views, buttons, clicks) |
| `tests/generator/print.ts` | Prints a program as `App.tsx` and its steps; checks it parses with `yuku-parser` |
| `tests/generator/generated.test.ts` | Runs random programs, shrinks a failure, reports it with a seed |
| `tests/generator/corpus.test.ts` | Runs every saved failure in `tests/corpus/` |

Run them with `bun test` in `packages/compiler-next` (no build needed), or one file:
`bun test cases/handlers`. Generated programs: `FC_RUNS=200 bun test generator`
(default 25), `FC_SEED=<seed>` to repeat a run, `SAVE_CORPUS=1` to keep the shrunk
failure.

`REFERENCE_ONLY=1 bun test cases` runs the reference without compiling. Each case's
optional `check` runs after mount (observation 0) and after each step, on both
renderers in the default mode. The ported regressions use it to assert known text
and DOM identity independently of the comparison, so two wrong renderers cannot
agree unnoticed. On PowerShell, set `$env:REFERENCE_ONLY = '1'` before the command;
remove it with `Remove-Item Env:REFERENCE_ONLY` to restore comparisons.

Cases may provide extra `modules` for imports. Steps include `respond` (JSON body
and optional HTTP status), `rejectRequest`, and `reject` for a named `defer`.
Each run owns and disposes its module work, sources and transport. Relative and
same-origin absolute request URLs compare by path and query. Use `--timeout 30000`
when this machine is busy; the default five-second per-case timeout can expire.

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

## Layers

1. **Reference renderer** (`tests/reference/`). Test-only: the framework never
   renders this way. After every step it calls every component again. The component
   body is setup code, so only derivations are computed again:
   - a binding reassigned by later code (handler, callback) is a `cell`: a snapshot;
   - any other `let x` / `const x` is a `memo`: computed again when a deep copy of
     its inputs changes, together with the body statements that build it (with no
     inputs it is computed once);
   - a prop reassigned by later code is a `prop` slot;
   - destructured aliases have the same cell/memo rules, with one native pattern
     evaluation per changed input;
   - every other body statement is setup and runs once, after its inputs are ready.

   A statement that calls something with a value (`x.anything()`, `f(x)`) runs inside
   `$ctx.observe`, which deep-copies the value before and compares it after. The
   reference uses no method list: it sees what really happened. If the statement
   changed the value, it builds it from then on.

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
   Ten passes without settling is an error, never a silently accepted result.
   The harness disposes apps and removes DOM even after a failed assertion or a
   failed compiled mount.

   That is `state-and-derived.md`, `refs.md` and `effects.md`, executable.

   Sources and ordinary `Group` policies now have an independently asserted
   baseline (`sources.md`). That page lists verified cases and remaining gaps,
   including atomic `suspend`. Routing and SSR are not modeled. JSX and TypeScript
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
The reference now runs 111 cases with its explicit assertions passing. This is
still reference development, not permission to start the compiler.
The old compiler has about 305 distinct `memo-dom:` messages. Most are internal
invariants or contracts of the framework's own APIs (`route-to`, `$routed`, `Group`,
`page()`, `mount()`, server functions); those stay. Only messages that reject
ordinary JavaScript become cases.

## Running

- Tests import `src` directly. No build is needed before running them.
- `bun run test:changed` _(planned)_ maps `git diff` to feature folders and runs only
  their tests, plus a small generated batch. A change in `core/` runs everything,
  but on CI. Features never import each other, so the mapping can be trusted.
- The local generated budget is small, for a slow machine. CI runs a large one.
- **CI**: none for now. The cases are small, so they run locally. GitHub Actions on
  `amiheretheophilus/auwla` (free, public repo) comes once the compiler exists and
  the suite reaches thousands of cases, including large generated batches.
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

