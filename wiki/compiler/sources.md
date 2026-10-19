# Sources and readiness

**Folder:** `features/sources/` _(planned)_.

## What it does

Finds values that load over time and makes everything computed from them wait.

## Rules

- A **source** is a `$fetch` call, a `$read` call, a GET server function call, or a
  call to a helper that returns one. The helper may be in the same module or
  imported; `definition()` from `yuku-analyzer` finds it either way. The old
  compiler missed same-module helpers.
- Server functions that are not GET are actions. They are never sources, because a
  mutation must not run just because a component rendered
  (`../decisions.md`, 2026-10-18).
- **Readiness** (`../rules.md`, rule 8): a node with a non-empty `pending(n)`
  (`core.md`) waits for those sources, everywhere:
  - a derived value is "not ready";
  - a **seed** (state whose initializer reads a source) takes its value when the
    source commits, unless the state was written first;
  - an effect first runs when its sources commit;
  - a source whose request reads another source does not start until that one commits;
  - a render site shows its boundary's pending UI;
  - an early return that reads a source waits too.
- A handler that reads a source before it has loaded gets a compile-time warning,
  not runtime magic.
- Loading and error UI come from the nearest `Group` boundary (`Boundary` in the
  plan). SSR uses the same plan: it waits, or renders the error UI.

## Inputs and outputs

- In: `Resolved`, linked module summaries (`linking.md`).
- Out: `Source` nodes and their `pending` sets; `Boundary` regions in the plan.

## Where to add things

- A new kind of source: one recognizer in `classify.ts`. Readiness follows from
  the graph and needs no new code.

## Cases to test

- A helper in the same module that returns `$fetch`: the old compiler does not see
  it as a source.
- Destructuring a source (old code `[MMD-S004]`, not yet checked).
- A seeded `let` written before its source loads: the old compiler overwrites the
  write.
- `tests/body-readiness.test.ts`: seeds, early returns, effects and chained requests.
