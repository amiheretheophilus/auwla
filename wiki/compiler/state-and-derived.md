# Props, state and derived values

**Folders:** `features/props/`, `features/state/`, `features/derived/` _(planned)_.

## What it does

Decides, for every binding in a component or module, whether it is a constant,
state or a derived value, and how each updates.

The compiler adds no meaning of its own. JavaScript runs as written; the compiler
only decides **what to re-run and when to update the UI**. Aliasing, in-place
`sort`, a mutated copy losing its edit when it is derived again: all of that is
JavaScript, and needs no rule here.

## Rules

`let` and `const` mean the same thing: either can be state or derived. Two facts
decide the kind: what the binding's value is computed from, and whether it is
reassigned **later**, by code that runs after the component body.

| Computed from | Reassigned later? | Kind |
| --- | --- | --- |
| nothing reactive | no | **constant**: computed once, never updates |
| nothing reactive | yes | **state**: holds its value until reassigned |
| something reactive | no | **derived**: re-run when what it reads changes |
| something reactive | yes | **state**: its first value is a snapshot; it never re-derives |

- **Reactive** means it reads a prop, state, derived value, source, ref or opaque node.
- **Reassigned later** means `x = …`, `x += …`, `x++` or `for (x of …)` in code that
  runs after the body: a handler, an effect, a callback ref, a timer or promise
  callback, or a function called from one of them. The compiler cannot replay those
  writes, so the binding stops being derived. The user: "the total first value
  becomes a snapshot … as there is a reassignment".
- **Writes in the component body are part of the derivation.** The declaration and
  every body statement that writes the binding (`if`, `switch`, loops) re-run
  together, in source order, when anything they read changes.
- A snapshot's body statements run once, with its initializer, as JavaScript does.
- **Mutation is not reassignment.** `x.push(1)`, `x.a = 1` and `delete x.a` keep the
  binding's kind. The edit shows; on a derived value it lasts until the value is
  derived again (`tests/derived-const-mutation.test.ts`).
- **Props** are derived from the parent. Reassigning a prop is a local override
  until the parent passes a different value (`../decisions.md`, 2026-10-19).
- A value computed by a function the compiler cannot see is still derived. The call
  re-runs when its arguments or captured values change. What it reads that the
  compiler cannot see is opaque.

```js
const total = price * qty;            // derived: follows price and qty

let total = price * qty;              // reassigned in a handler → snapshot, computed once
<button onClick={() => (total = 0)} />

let label = user.name;                // derived: the declaration and the if
if (!label) label = 'Anonymous';      // re-run together when user changes

let label;                            // derived the same way
if (user.name) label = user.name; else label = 'Anonymous';

let sum = 0;                          // derived: the loop re-runs when items changes
for (const item of items) sum += item.price;
```

## Inputs and outputs

- In: `Resolved` (initializer references, write sites and where they run,
  mutation sites).
- Out: `Constant`, `State` and `Derived` nodes with their `reads` edges. A `Derived`
  node lists the body statements that build it, in source order.

## Where to add things

- A new way to write a binding (a new assignment form): `core/resolve/`, which
  finds write sites. The rules here do not change.

## Cases to test

Each must compile and show on the UI what the console shows.

- `let label = user.name; if (!label) label = 'Anonymous';`: the old compiler rejects it.
- `const items = makeList()`, written, then rendered as a list.
- writes and read-only methods on a `[1].concat([2])` result;
- reassigning a prop, and `++` on a prop;
- `sorted.push(x)` on `const sorted = items.slice()`;
- writing a module computed;
- chained and value-position assignments: `a = b = 1`, `last = count++`;
- derivation writes at module scope (old message: "cannot assign computed");
- destructuring reactive state (old message: "destructuring snapshots reactive state").
