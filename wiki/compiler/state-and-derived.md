# Props, state and derived values

**Folders:** `features/props/`, `features/state/`, `features/derived/` _(planned)_.

## What it does

Decides, for every binding in a component or module, whether it is a constant,
state or a derived value, and how each updates.

## Rules

`let` and `const` mean the same thing: either can be state or derived. Two facts
decide the kind: what the initializer reads, and whether the binding is
**reassigned** anywhere.

| Initializer reads | Reassigned anywhere? | Kind |
| --- | --- | --- |
| nothing reactive | no | **constant**: computed once, never updates |
| nothing reactive | yes | **state**: holds its value until reassigned |
| something reactive | no | **derived**: recomputed when what it reads changes |
| something reactive | yes | **state**: the initializer is a snapshot taken once; it never re-derives |

The user (2026-10-19): "the total first value becomes a snapshot meaning price and
qty change will no re derive it again as there is a reassignment total = 0 it has
broken the derive rules". A `const` cannot be reassigned, so a `const` with a
reactive initializer is always derived.

```js
let total = price * qty;               // reassigned below → snapshot: price * qty, once
<button onClick={() => (total = 0)} />
// price or qty change → total does not change
// click → total is 0

const total = price * qty;             // derived: follows price and qty
```

- **Reactive** means it reads a prop, state, derived value, source, ref or opaque node.
- **Reassigned** means `x = …`, `x += …`, `x++`, `for (x of …)`, wherever it is
  written: a handler, an effect, the component body or a nested function.
- **Mutation is not reassignment.** `x.push(1)`, `x.a = 1` and `delete x.a` keep a
  binding's kind:
  - on state, the edit shows on the UI;
  - on a derived object, the edit shows until an input changes; then the value is
    derived again and the edit is gone (`tests/derived-const-mutation.test.ts`).

  ```js
  const sorted = items.slice().sort(byName);  // derived from items
  <button onClick={() => sorted.push(zed)} />
  // click → Zed shows; the parent sends new items → the new list, without Zed
  ```
- **Props** are derived from the parent. Reassigning a prop is a local override
  until the parent passes a different value (`../decisions.md`, 2026-10-19).
- A derived value whose initializer calls a function the compiler cannot see is
  still derived. The call re-runs when its arguments or captured values change.
  What it reads that the compiler cannot see is opaque.

### Plain JavaScript that behaves as written

These are not extra rules. They are what JavaScript does, and the UI must show it:

- `const view = items` is an alias, not a copy. `view.push(x)` changes `items` too, so
  everything that reads `items` updates, including the parent that owns it.
- `const sorted = items.sort(byName)` sorts `items` in place, every time it is
  derived. Use `items.slice().sort(…)` or `items.toSorted(…)` for a sorted copy.

## Inputs and outputs

- In: `Resolved` (initializer references, reassignment and mutation sites).
- Out: `Constant`, `State` and `Derived` nodes with their `reads` edges.

## Where to add things

- A new way to write a binding (a new assignment form): `core/resolve/`, which
  finds write sites. The rules here do not change.

## Open questions

- **Statements in the component body** (`if`, `switch`) are reactive in the old
  compiler:

  ```js
  let label;
  if (user.name) label = user.name; else label = 'Anonymous';  // re-runs when user changes
  ```

  The old compiler rejects
  `let label = user.name; if (!label) label = 'Anonymous';` ("reads its own previous
  value"). That is a rule-10 bug (`../rejections.md`). Proposed reading:
  - `label`'s initializer is a snapshot, because `label` is reassigned;
  - the `if` is a reactive statement that re-runs when what it reads changes;
  - a statement's own writes do not re-run it, so `if (x) x = x + 1` cannot loop.

  With that reading, the defaulted form never follows `user`. The `if`/`else` form
  does, because its test reads `user`. Waiting for the user to confirm.
