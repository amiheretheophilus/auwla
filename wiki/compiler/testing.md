# Testing

**Folders:** `packages/compiler-next/tests/`, `features/*/*.test.ts`,
`optimize/*.test.ts` _(planned)_.

## What it does

Checks that compiled output behaves like plain JavaScript, without listing every
JavaScript case by hand.

## The idea

The right answer comes from JavaScript itself: "every expression that we can see it
effect in the console means we need to see it on the ui" (`../rules.md`, rule 10).
So every test compares the compiled component with a **reference renderer** that is
slow and obviously correct.

## Layers

1. **Reference renderer** (`tests/reference/` _(planned)_). It re-runs the whole
   component function after every event and renders it to HTML. State keeps its
   value between runs: a small transform reads it from a store and saves every write.
   Derived values are correct by construction, because everything is recomputed. It
   follows `state-and-derived.md` exactly, so it is also the executable version of
   those rules.
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

`../rejections.md` is the first seed for the corpus: each entry is a case the old
compiler rejected.

## Running

- Tests import `src` directly. No build is needed before running them.
- `bun run test:changed` _(planned)_ maps `git diff` to feature folders and runs only
  their tests, plus a small generated batch. A change in `core/` runs everything,
  but on CI. Features never import each other, so the mapping can be trusted.
- The local generated budget is small, for a slow machine. CI runs a large one.
- **CI** is GitHub Actions on `snrraptopack/memo-exp`. The repo is public, so it costs
  nothing. Every push to `compiler-rewrite` runs the full suite and a large generated
  batch.
- **Performance:**
  - shared runners give noisy timings, so a job runs the base and the change
    alternately and reports the relative difference;
  - stable numbers need a self-hosted runner on the separate VM.

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

- CI access: a fine-grained token limited to this repo, or a bot account?
- What is the separate VM, and can it be a self-hosted runner?
