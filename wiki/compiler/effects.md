# Effects

**Folder:** `features/effects/` _(planned)_.

## What it does

Runs `$effect` callbacks after commits, re-runs them when what they read changes,
and runs their cleanup.

## Rules

- An effect's reads are found like a derived value's: whatever it reads in its body,
  directly or through derived values and helpers it calls. Reads inside callbacks it
  creates are not its reads: they run later (`connection.onMessage(() => unread++)`).
- **Open:** does `x++` or `x += 1` inside the effect make `x` one of its reads? See
  the open question below.
- The component body is setup code: it runs once. `fetch(...).then(...)` or
  `defer(...)` in the body starts once, and its writes update the UI later.
- It runs after its owner commits and its refs have mounted, then again whenever a
  node it reads changes. Its cleanup runs before each re-run and at teardown.
- `$effect` inside `if`, a loop or a helper is accepted. Its reads include the
  condition.
- An `async` callback is accepted: it runs, and its cleanup is whatever it resolves
  to, or none.
- Writes inside an effect are writes like any handler's (`handlers.md`).
- An effect with a non-empty `pending(n)` first runs when its sources commit
  (`sources.md`).

## Inputs and outputs

- In: `Resolved`, the graph.
- Out: `Effect` nodes with `reads` and `writes` edges.

## Cases to test

In `packages/compiler-next/tests/cases/effects.test.ts`.

The old compiler fails these:

- `$effect(async () => …)`: rejected.
- An effect that does `runs++` (or `starts++`), including one inside an `if`: the
  old runtime counts the update as a read, so the effect re-triggers itself until
  its cycle guard throws. The reference does not count it as a read. This waits
  on the open question below.

These pass today and must keep passing:

- setup code in the body runs once;
- an effect tears down before it runs again;
- an effect reads a ref;
- `$cleanup` runs when the component unmounts;
- an effect at module scope.

Not written yet: `$cleanup` in places the old compiler does not allow.

## Open questions

- Should `x++` / `x += 1` inside an effect subscribe the effect to `x`? If yes, every
  effect that counts something loops. If no, the effect does not re-run when `x`
  changes elsewhere either; it only re-runs for its plain reads.
