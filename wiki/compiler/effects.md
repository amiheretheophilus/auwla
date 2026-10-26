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
- Writes inside an effect are writes like any handler's (`handlers.md`).
- An effect with a non-empty `pending(n)` first runs when its sources commit
  (`sources.md`).

## Inputs and outputs

- In: `Resolved`, the graph.
- Out: `Effect` nodes with `reads` and `writes` edges.

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
- `$cleanup` runs when the component unmounts;
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

Not covered yet: the rest of the `$cleanup` placement matrix and more async
continuation/helper interleavings. Source-dependent effects remain Phase 8.
