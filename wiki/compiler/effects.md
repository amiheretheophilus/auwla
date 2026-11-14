# Effects

**Folder:** `features/effects/` (DOM built; Phase 8 adds readiness).

## What it does

Runs `$effect` callbacks after commits, re-runs them when what they read changes,
and runs their cleanup.

## Files and implementation

- `plan.ts` recognizes unshadowed lifecycle calls by binding and finds the native
  statements that activate them, including visible helper calls. Component returns
  remain in their selector; only non-returning registration statements are wrapped.
- `dom.ts` emits lifecycle calls and activation watches. All arguments, including
  extra arguments and spreads, evaluate in authored order. No exception wrapper
  is emitted.
- `runtime/src/effect.ts` shares registration with old output. Compiler-next opts
  into the existing computation collector and write batches. Effects run after DOM
  work and deferred refs, replace their subscriptions after execution, and settle
  their own writes. Existing build-frame recovery keeps throwing callbacks retryable.
- `runtime/src/effect-scope.ts` owns activations in the existing entity tree. A
  registration site plus its occurrence distinguishes loop iterations. Missing
  occurrences dispose their effects. A helper inherits the calling activation.
  Early-return selectors retain, dispose and reactivate their reached groups.
- `runtime/src/build-scope.ts` marks effect execution ownership. Shared storage
  initialized during that execution retains its native values for cleanup instead
  of independently replaying its memos.

## Rules

- An effect's reads are found like a derived value's: whatever it reads in its body,
  directly or through derived values and helpers it calls. Reads inside callbacks it
  creates are not its reads: they run later (`connection.onMessage(() => unread++)`).
- An update of a binding (`x++`, `x += 1`) is a write, not a read: it does not make
  the effect re-run when `x` changes. Otherwise every effect that counts something
  would re-trigger itself (`../decisions.md`, 2026-10-19).
- The component body is setup code: it runs once. `fetch(...).then(...)` or
  `defer(...)` in the body starts once, and its writes update the UI later.
- It runs after its owner commits and its refs have mounted, then again whenever a
  node it reads changes. Its cleanup runs before each re-run and at teardown.
- A write that leaves the same primitive or field value is not a change (`n = 1` when
  it is 1, `o.a = 1`). A new object is, even with equal contents (`rows =
  rows.slice()`). See `tests/cases/handlers.unchanged.test.ts` and `../decisions.md`,
  2026-11-05. Reassigning the same object still reports: an effect reading `rows`
  re-runs after `rows = rows`, since code the compiler cannot see may have edited it.
- `$effect` inside `if`, a loop or a helper is accepted. Its reads include the
  condition.
- An `async` callback is accepted: it runs, and its cleanup is whatever it resolves
  to, or none.
- Locals created during an effect run belong to that execution (user decision,
  2026-10-26). `const value = count; return () => log(value)` retains that run's
  value. `return () => log(count)` reads the outer binding when cleanup runs.
- A resolved async cleanup belongs to its original execution. If that execution
  was replaced or removed, run the late cleanup immediately; never replace the
  current execution's cleanup with it.
- Writes inside an effect are writes like any handler's (`handlers.md`). Editing state is not
  reading it either: `log.push(x)` or `state.count = 1` reads its root untracked (`handlers.md`,
  "Edits are not reads"), so an effect that only edits `log` does not follow it.
- An effect's own synchronous writes do not re-run it (`../decisions.md`, 2026-10-19), but it keeps
  following what it genuinely reads, even state it also writes: in `seen(log.length); if
  (log.length === 1) log.push('auto')` its own push is settled when the run ends, and the next push
  by anything else runs it again. The runtime used to drop every key the effect wrote from its
  dependencies, so that effect saw `[0, 1]` and never ran again; effect computations now keep them
  (`createComputation(…, keepsOwnWrites)`, `runtime/src/computation.ts`). A derivation still drops
  what it writes (`s = s || {}` never replays when `s` changes). `mutations.test.ts` checks
  `[0, 1, 3]`.
- An effect with a non-empty `pending(n)` first runs when its sources commit
  (`sources.md`).

## Inputs and outputs

- In: `Resolved`, the graph.
- Out: lifecycle calls and activation groups in the plan, reusing the graph's
  binding read/write facts and runtime computation tracking.

## Cases to test

In `packages/compiler-next/tests/cases/effects.test.ts`: 18 reference comparisons,
each also run with compiler optimizations enabled and disabled. Added cases pin
named callbacks/helper reads, unexecuted callback captures, truthy activation
retention, DOM/cleanup order, per-run captures, loop occurrence removal, both
early-return shapes, helper registration ownership, stale async cleanup and native
argument evaluation. The original assertions remain unchanged.

`packages/runtime/tests/effect-scope.test.ts` independently checks obsolete and
post-unmount async cleanup, replacement with the same entity id, recovery after a
throwing callback and loop/helper ownership.
It also verifies ref ownership before setup completes and early cleanup detachment.

The old compiler fails these:

- `$effect(async () => …)`: rejected.
- An effect that does `runs++` (or `starts++`), including one inside an `if`: the
  old runtime counts the update as a read, so the effect re-triggers itself until
  its cycle guard throws.

These pass today and must keep passing:

- setup code in the body runs once;
- an effect tears down before it runs again;
- an effect reads a ref;
- `$cleanup` runs when the component unmounts, including one in a helper, which belongs to the
  component running it (`ownCleanups`, emitted only in a graph with such a helper);
- an effect at module scope.

The reference compares effect inputs after refs mount, and records them after the
callback's synchronous writes. Those writes update the UI without immediately
re-triggering the same effect (`../decisions.md`, 2026-10-19). When a conditional effect leaves, its cleanup's
writes get another render too; the case asserts the start and stop counts. See
`refs.md` for the ref-identity log case.

The reference independently reconciles per-render registrations and loop
occurrences. It retains generated readiness reads' binding identities while
component slots are lowered, and async cleanup generations prevent stale results
from overwriting current teardown. These fixes retain the explicit expectations,
including the user-approved per-execution capture rule.

`$cleanup` in a branch, a helper and a list row, and an async effect whose result arrives after a
newer run, are in `tests/cases/coverage.test.ts`.
