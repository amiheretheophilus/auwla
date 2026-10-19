# Props, state and derived values

**Folders:** `features/props/`, `features/state/`, `features/derived/` _(planned)_.

## What it does

Decides, for every binding in a component or module, whether it is a constant,
state or a derived value, and how each updates.

## Rules

`let` and `const` mean the same thing: either can be state or derived. Two facts
decide the kind: what the initializer reads, and whether the binding is reassigned
later.

| Initializer reads | Reassigned later? | Kind |
| --- | --- | --- |
| nothing reactive | no | **constant**: computed once, never updates |
| nothing reactive | yes | **state**: holds its value until reassigned |
| something reactive | no | **derived**: recomputed when what it reads changes |
| something reactive | yes | **derived until the first reassignment**, then state: it keeps the value written and stops following its inputs |

The last row, from the user: "once a variable is derived and later that variable
get reassigned since the compiler cant replay it looses it derivation".

```js
let total = price * qty;   // derived: follows price and qty
<button onClick={() => (total = 0)} />
// before the click: price or qty changes → total updates
// after the click:  total is 0 and stays 0 when price or qty changes
```

- **Reactive** means it reads a prop, state, derived value, source, ref or opaque node.
- **Reassigned** means `x = …`, `x += …`, `x++`, `for (x of …)` anywhere: a
  handler, an effect, the component body or a nested function.
- **Mutation is not reassignment.** `x.push(1)` and `x.a = 1`:
  - on state, the edit shows on the UI;
  - on a derived object, the edit shows, and when its inputs change it is derived
    again. This is today's behaviour (`tests/derived-const-mutation.test.ts`).
- **Props** are derived from the parent. Reassigning a prop is a local override
  until the parent passes a different value (`../decisions.md`, 2026-10-19).
- A primitive `const` cannot be reassigned: JavaScript throws, so nothing extra is
  needed.
- A derived value whose initializer calls a function the compiler cannot see is
  still derived. The call re-runs when its arguments or captured values change; what
  it reads that the compiler cannot see is opaque.

## Inputs and outputs

- In: `Resolved` (initializer references, reassignment and mutation sites).
- Out: `Constant`, `State` and `Derived` nodes with their `reads` edges. A `Derived`
  that is reassigned carries a flag, so emission stops recomputing it after the
  first write.

## Where to add things

- A new way to write a binding (a new assignment form): `core/resolve/`, which
  finds write sites. The rules here do not change.

## Open questions

- Is "derived until the first reassignment" the right reading? The other reading is
  that a binding reassigned anywhere is state from the start. The old compiler does
  that for a written `let` (`../rules.md`, rule 11).
- Should a mutated derived object also stop following its inputs, like a reassigned
  one? Today it re-derives.
