# Effects

**Folder:** `features/effects/` _(planned)_.

## What it does

Runs `$effect` callbacks after commits, re-runs them when what they read changes,
and runs their cleanup.

## Rules

- An effect's reads are found like a derived value's: whatever it reads in its body,
  directly or through derived values and helpers it calls.
- It runs after its owner commits and its refs have mounted, then again whenever a
  node it reads changes. Its cleanup runs before each re-run and at teardown.
- `$effect` inside `if`, a loop or a helper is accepted. Its reads include the
  condition.
- An `async` callback is accepted: it runs, and its cleanup is whatever it resolves
  to, or none (`../rejections.md`).
- Writes inside an effect are writes like any handler's (`handlers.md`).
- An effect with a non-empty `pending(n)` first runs when its sources commit
  (`sources.md`).

## Inputs and outputs

- In: `Resolved`, the graph.
- Out: `Effect` nodes with `reads` and `writes` edges.
