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

### Which body statements build a value

A body statement builds a binding when it reassigns it, or changes the value it
holds. Loops count like `if`: `let sum = 0; for (…) sum += x` is the same derivation
as `items.reduce(…)`, so it replays (`../decisions.md`, 2026-10-19).

Whether a call changes the value is decided like this:

- **Known methods**, from the list in `optimize/methods.ts` _(planned)_: the list says
  whether the method changes its receiver (`push`, `splice`, `sort`, `set`, …) or only
  reads it (`includes`, `map`, `slice`, `get`, …). No runtime cost.
- **Anything else** (an unknown method, or the value passed to a function): a runtime
  check around the statement. The value is deep-copied before, the statement runs,
  and the copy is compared after. If it changed, the statement builds the value from
  then on; if not, it only read it. Only these statements pay for the check.

```js
let picked = [];                                              // a handler pushes into it
for (const x of others) if (picked.includes(x)) count++;      // known read: builds count, not picked

const rows = [];
for (const n of items) rows.push(<li key={n}>{n}</li>);       // known change: builds rows

for (const x of others) picked.check(x);                      // unknown: checked at runtime
```

The list only makes this faster. A method that is not on it is still correct
(`../rules.md`, rule 3).

## Cases to test

In `packages/compiler-next/tests/cases/state-and-derived.test.ts`. Each must compile
and show on the UI what the console shows.

The old compiler fails these:

- `let label = user.name; if (!label) label = 'Anonymous';`: rejected.
- A loop in the body, `for (const item of items) sum += item.price`: it does not
  re-run when `items` changes.
- `<p>{a}{b} {count}</p>`: adjacent text values are joined with `+`, so two numbers
  are added (`0` instead of `00`, `2` instead of `11`).
- A body loop that only reads a list (`if (picked.includes(x)) count++`): `count`
  never updates (same cause as the loop above).
- A body loop that calls an unknown method: `bag.add(n)` that changes `bag`, and
  `picked.has(x)` that only reads it. Neither updates.

These pass today and must keep passing:

- a counter;
- a `const` derived from state;
- a binding reassigned in a handler is a snapshot;
- an `if`/`else` that assigns in every branch;
- `sorted.push(x)` on a sorted copy, then the source changes;
- `const items = makeList()`, written, then rendered as a list;
- writes on a `[1].concat([2])` result;
- reassigning a prop with `++`, then the parent sends a new value;
- writing a module value derived from module state;
- destructuring reactive state.
- values returned by helpers, `concat`, an object spread member and `Array.from`,
  with both `let` and `const`, rendered as text or keyed rows;
- mutation of computed-key objects and helper-returned objects;
- a handler reading a method chain on an array literal;
- array, object and `new Set` initializers reading state;
- reassigning a module object;
- mutating a derived copy, then mutating its source;
- prop overrides surviving unrelated prop updates, updating derivations, and
  remaining independent in keyed rows.

The ported root regressions also assert the known text after each step on both
renderers (`Case.check`), independently of their DOM comparison.

The reference now gives destructured aliases the same cell/memo treatment: the
authored pattern runs natively once per changed input, and an alias written later
keeps a snapshot. Source/default/rest cases are on `sources.md`. Module derivations
refresh before component rendering.

Not written yet: derivation writes at module scope (old message: "cannot assign
computed").

### Mixed state, classes and accessors

Fourteen `complex state:` cases combine module and component state with native
class behavior. They have explicit assertions after each interaction. The old
compiler passes thirteen and fails one:

| Case | Expected | Old compiler result |
| --- | --- | --- |
| `complex state: static class fields and getters feed component derivations` | Both summaries change from `3` to `5`, then `7` | Both stay on `3` after the first static-field write |

The passing cases cover shared module instances alongside independent component
instances; constructors with reactive arguments and constructor snapshots;
preserving instance edits across unrelated writes; getters, setters, postfix
results and clamping; inheritance, `super` and overridden methods; object-literal
accessors; an imported class store combined with module and component values;
constructors returning ordinary objects; direct private-field reads/writes through
accessors and methods; computed accessors and destructured snapshots; setters
updating several fields seen by sibling components; unused own getters; and
symbol-backed accessor derivations.

The reference's own-property snapshots (`tests/reference/runtime.ts`) inspect data
descriptors, including symbols and non-enumerable backing fields, without
invoking own getters. Constructor functions with static data are snapshotted too.
Three unchanged assertions caught reference bugs before comparison: static fields
were ignored, symbol data was ignored, and snapshots executed an unused getter.
All fourteen cases now reach the old compiler and have both generated versions.

This is not exhaustive class coverage. Still to model and test: cached derivations
whose only input changes are private fields or values captured by getters; further
prototype/descriptor changes; and Proxy/WeakMap-backed state. The tested private
case reads the accessor directly in JSX; it does not validate private-only memo
invalidation. These remain correctness requirements, never permitted failures
for the rewrite. JSX combinations with class instances are on `components.md`.

### Spread, rest and recursive helpers

Eleven more cases check ordinary copy/rest patterns and recursive computation.
The ten `spread/rest:` cases cover the exact `const a = [...b]` and `{ ...b }`
forms: local mutations survive unrelated writes and reset when their source
changes. Both copies remain shallow. A write through a shared nested reference
also changes the source, so the derived copy replays under rule 11. Native array
and object rest, computed exclusions, symbols, defaults, reassigned rest snapshots,
rest parameters/spread arguments, and module-to-component copy chains are covered.
The `recursive patterns:` case uses mutually recursive helpers over a nested tree.

The reference passes all eleven. The old compiler passes rest parameters with
spread arguments and nested rest/default patterns; nine cases fail:

| Case | Expected | Old compiler result |
| --- | --- | --- |
| `spread/rest: array copy mutations survive unrelated writes until the source changes` | After editing `a`, changing `b` rebuilds `a` as `1,2,3` | `a` stays `1,2,9` while `b` is `1,2,3` |
| `spread/rest: object copy writes additions and deletions reset only with its source` | Source mutation restores `a.qty = 2`, `label = 'base'`, and removes the local extra field | Keeps `qty = 9`, missing label and the local extra field |
| `spread/rest: array spread is shallow and nested mutations still reach the original` | Shared nested mutation changes both sources and replays `a` to just `2` | Nested value changes, but `a` incorrectly retains its appended `9` |
| `spread/rest: object spread shares nested references while isolating top-level writes` | Shared nested mutation replays `a.count` to source value `1` | Keeps local `a.count = 9` |
| `spread/rest: array destructuring rest can be mutated and rederived` | Pushing `9` into `tail` shows `2,3,9` immediately | Still shows `2,3` |
| `spread/rest: computed object rest excludes selected keys and retains symbols` | Setting `rest.other = 9` shows `9`, retaining its symbol and excluded-key behavior | Still shows `2` |
| `spread/rest: a reassigned rest binding is a snapshot while other aliases remain derived` | Source mutation updates `selected` from `1` to `2`, keeping `rest` a snapshot | `selected` remains `1`; later override assertions are not reached |
| `spread/rest: module and component copies each preserve local edits until their input changes` | Updating `moduleCopy` to `1,9` replays `localCopy` to `1,9` | `localCopy` keeps its stale `1,8` edit |
| `recursive patterns: mutually recursive helpers rederive from nested state` | Native recursion computes `3`, `4`, `8`, then `16` as nested state/module factor change | Rejects recursive helper `sum` as something that "cannot be analyzed" |

All assertions are unchanged. Ten cases have both generated versions; the
mutually recursive helper is rejected before emit. Further recursive/aliasing
programs belong in the generator too, not just hand-written examples.
