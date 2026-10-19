# Testing

**Folders:** `packages/compiler-next/tests/` (built), `features/*/*.test.ts` and
`optimize/*.test.ts` _(planned)_.

## Files

| File | What it does |
| --- | --- |
| `tests/reference/transform.ts` | Turns a module into a reference module: decides which bindings need a slot (built on `yuku-analyzer`, `yuku-ast`, `yuku-codegen`) |
| `tests/reference/runtime.ts` | Runs the reference: re-renders everything, keeps slots per component instance |
| `tests/harness/case.ts` | The `Case` and `Step` types, and `defer(name)` for async cases |
| `tests/harness/run.ts` | `behaves(name, case)`: runs the case on the reference and on a compiler, compares after each step |
| `tests/harness/compilers.ts` | The compilers a case can run on; `COMPILER=old` (default) is `packages/compiler` |
| `tests/harness/serialize.ts` | The visible DOM as a comparable string |
| `tests/cases/<page>.test.ts` | One file per wiki page; holds that page's "Cases to test" |

Run them with `bun test` in `packages/compiler-next` (no build needed), or one file:
`bun test cases/handlers`.

## What it does

Checks that compiled output behaves like plain JavaScript, without listing every
JavaScript case by hand.

## The idea

The right answer comes from JavaScript itself: "every expression that we can see it
effect in the console means we need to see it on the ui" (`../rules.md`, rule 10).
So every test compares the compiled component with a **reference renderer** that is
slow and obviously correct.

## Layers

1. **Reference renderer** (`tests/reference/`). Test-only: the framework never
   renders this way. After every step it calls every component again and builds a
   new DOM tree, with no diffing. Component calls are matched to their instance by
   position and `key`, so values that must outlive a render keep it in a slot:
   - a binding reassigned by later code (handler, callback) is a `cell`: a snapshot,
     and the body statements that write it run on the first render only;
   - a binding used by later code but not reassigned is a `memo`: kept until a deep
     copy of its inputs changes, with the body statements that mutate it;
   - a prop reassigned by later code is a `prop` slot;
   - everything else is recomputed.

   That is `state-and-derived.md`, executable.

   **Limits today:** refs, `$effect`, sources (`$fetch`, `$read`, server functions)
   and routing are not supported yet. A destructuring declaration is always
   recomputed. JSX and TypeScript are lowered by Bun's transpiler, because
   `yuku-codegen` drops `enum` instead of converting it.
2. **Comparison tests.** A case is a component and a list of events. After the first
   render and after each event, the compiled DOM must equal the reference DOM.
3. **Generated programs.** `fast-check` builds random components from JavaScript
   building blocks: literals, operators, aliasing, closures, destructuring, method
   calls, mutation, control flow, async, JSX shapes. A failure shrinks to the
   smallest program that still fails. That program is saved to `tests/corpus/` and
   runs in every later run.
4. **Feature tests** next to each feature, for its graph and plan facts.
5. **Optimizations on and off.** Every comparison test runs twice; both runs must
   match the reference (`optimize.md`).
6. **Strict checks** on every compile:
   - valid input never gives a compile error;
   - output never contains `try`, `catch` or `finally` that were not authored;
   - output parses with `yuku-parser`.
7. **Acceptance.** The old suites (root `tests/`, package tests, Vite, the Conduit
   flows) run against `compiler-next` through a switch. When they all pass, the old
   compiler is deleted.

The first cases are the **Cases to test** section of each concept page, written in
`tests/cases/<page>.test.ts`. Each one is a case the old compiler rejects or shows
wrong, or behaviour it must keep. On 2026-10-19, against the old compiler: 20 pass
and 12 fail, each failure a known old-compiler bug listed on its page.
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
- **CI** _(planned)_ is GitHub Actions on `amiheretheophilus/auwla`. The repo is public,
  so it costs nothing. Every push to `compiler-rewrite` runs the full suite and a large generated
  batch.
- **Performance** uses `bench/`, not CI:
  1. A local run checks that the benchmarks pass their correctness gates. Local
     timings are noisy and are not compared.
  2. The user then runs `bench/` on a different machine. Those numbers are the ones
     compared against the baseline below.

## Performance baseline

The last full benchmark of the old compiler is `d6e678b`: 8 CPUs and 8 GiB on an
AMD EPYC VM, Chrome Headless Shell 149. `compiler-next` must not fall below it
on the same benchmarks:

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

## Open questions

- CI for tests (not benchmarks): set it up on `amiheretheophilus/auwla` now that the
  first tests exist?
