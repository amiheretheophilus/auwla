# State

Memoized DOM is a reactive programming model wearing plain TypeScript. There
are no signals, stores, hooks, or wrappers. You write normal variables,
objects, arrays, and classes — the **compiler** watches who reads and who
writes, and the runtime updates only the DOM that depends on what changed.

## The one idea

> Reactivity follows reads and writes — not `let`, not `const`, not a special
> type.

If a value is read by the UI (or by a derived value) and the compiler can see
a write that might change it, the two are linked. That's the whole mechanism.

```tsx
export function Counter() {
  let count = 0;
  let doubled = count * 2;     // derived — replays when count changes

  return <button onClick={() => count++}>{count} / {doubled}</button>;
}
```

No `useState`. The component body runs once; `count++` in the handler updates
exactly the text nodes that read `count` and `doubled`.

## `let` vs `const` — pick by meaning, not reactivity

`let` and `const` keep their normal JavaScript meaning:

```ts
let count = 0;              // the binding itself gets reassigned
const state = { step: 1 };  // binding fixed, contents can change
const items: string[] = []; // binding fixed, contents can change
```

So:

- **`let` doesn't create reactivity.** `let label = 'hi'` that's never
  reassigned is just a variable.
- **`const` doesn't block reactivity.** `state.step++`, `items.push(x)`,
  `set.add(x)` are all valid reactive writes.
- **`let` can be derived.** An initializer that reads reactive state, such as
  `let doubled = count * 2`, replays when the source changes, as long as the
  binding is never written.
- Use `const` whenever you only mutate contents. Reach for `let` only when
  the binding itself is reassigned (`count++`, `name = 'x'`) or when it reads
  reactive state as a derived value.

### When a derived value becomes local state

A `let` initialized from reactive state (a variable, a prop, a loaded value,
or a function's result) follows that source **until anything writes to the
binding**. One write anywhere in the component, even in a distant handler,
makes it local state, initialized once from the source and owned by you:

| Declaration | Written? | Behavior |
|---|---|---|
| `let x = source` | never | derived: follows `source` |
| `let x = source` | reassigned (`x = …`) | local state, initialized once |
| `let x = source` | mutated (`x.name = …`) | local state, initialized once; the mutation changes the object captured at mount |
| `const x = source` | mutated (`x.name = …`) | derived alias: follows `source`, and writes go to its current object |
| `const x = [...source]` (a copy built from `source`) | edited (`x.push(…)`, `x[0] = …`) | derived copy: the edit shows at once; when `source` changes, `x` is copied again |

A `const` keeps following its source in both cases. When it aliases the
source, edits go to the source. When it is your own copy, edits change the copy,
and a new source value replaces it with a fresh copy:

```tsx
function TagEditor({ article }) {
  const tags = [...article.tags];          // follows article
  return <>
    {tags.map(tag => <span>{tag}</span>)}
    <button onClick={() => tags.push('draft')}>Add</button>   {/* shows at once */}
  </>;
}
```

This is deliberate. A binding cannot follow its source and keep your writes at
the same time; if it followed, every update to the source would silently
overwrite them. The usual case is an edit buffer, where keeping your writes is
the point (see [Editing a copy of loaded data](./05-data.md#editing-a-copy-of-loaded-data)):

```tsx
let text = note.text;   // written by onInput below: local state, set once
<input value={text} onInput={(e) => text = e.currentTarget.value} />
```

Because the switch is caused by a write that can be far from the declaration,
check for it when a `let` "stops updating". To follow the source again, copy
it yourself at the moment you want the new value (`text = note.text` when
editing starts), or read the source directly instead of the local copy.

A derived initializer stays live. If you need a one-time snapshot, wrap the
initializer in `$snapshot`; otherwise later source writes will replay it:

```tsx
const current = state.user;            // follows state.user
const saved = $snapshot(state.user);   // keeps this object, e.g. for undo
```

`$snapshot` is equivalent to declaring the variable and assigning it in a
separate statement, a form that still works.

## State can live anywhere

### In a component — per instance

```tsx
export function SearchBox() {
  let query = '';
  const trimmed = query.trim();

  return <input onInput={(e) => query = e.currentTarget.value} />;
}
```

Each mounted instance gets its own `query`. The body is initialization code,
not a re-render — writes update the DOM directly.

### At module scope — shared

Any module-level variable, object, or collection is shared reactive state.
Export it, mutate it from a helper, read it in a component:

```ts
// cart.ts
export const items = new Set<string>();
export function addItem(name: string) { items.add(name); }
```

```tsx
// Cart.tsx
import { items, addItem } from './cart';

export function Cart() {
  return (
    <section>
      <p>{items.size} items</p>
      <button onClick={() => addItem('book')}>add</button>
    </section>
  );
}
```

`items.size` re-renders when `add`/`delete` mutates the Set. No store
primitive, no subscription — the compiler links the write to the read across
files. The same works for `Map`, arrays, and plain objects.

### In a class — plain TypeScript

```ts
export class Todos {
  list: { id: number; done: boolean }[] = [];

  toggle(id: number) {
    const todo = this.list.find(t => t.id === id);
    if (todo) todo.done = !todo.done;
  }
}
export const todos = new Todos();
```

Method writes are analyzed like any other write. No base class, no proxy.

## Derived state is just an expression

```tsx
export function Cart() {
  const items = [{ price: 20, qty: 1 }, { price: 5, qty: 3 }];
  let coupon = 0;

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = subtotal - coupon;

  return <output>{total}</output>;
}
```

- Write it as a `const` expression — no `computed()` exists.
- Both `const` and `let` initializers that read reactive state are derived.
  `let doubled = count * 2` replays when `count` changes, until something
  writes `doubled`; then it is local state
  ([details](#when-a-derived-value-becomes-local-state)). Use `$snapshot(...)`
  when you need an explicit one-time snapshot.
- Chains work: `a` → `b` → `c` replays in order when `a` changes.
- Pure helper calls inside derivations are fine.
- **Never write to a derived value** — `total++` is invalid; update `coupon`.

## Opaque values

Values whose changes the compiler cannot see use a browser-frame pull fallback.
Their reads remain live. A volatile component can skip unrelated primitive local
DOM slots and ordinary primitive derived calculations on a pull frame when the
compiler proves that their values change only through successfully published
writes. Object coercions, getters, unknown calls and unproven callbacks retain
conservative refreshes. Values selected by reactive control flow retain pulls,
including their downstream calculations and DOM slots. Normal writes still
update their dependent calculations and slots, including when a write and a
pull are batched together.

## `if` and `switch` are reactive too

Control flow that reads reactive state replays when that state changes —
and the read doesn't have to be direct. A condition on a derived `const` or `let`,
a prop, or an imported module value tracks the original source
transitively. Pure value calculations that depend only on opaque inputs also
replay on browser-frame pulls, even when JSX only reads the calculated result.
Visible component and module helpers contribute their captured reads. Linked
helpers carry captured opaque reads through imports and re-exports separately
from their write effects, so read-only helpers retain the pull fallback without
broadening ordinary write routing. Partial
calculations restore their initializer when no branch matches; imperative
setup statements retain their one-time behavior.

Branching that picks a **value** stays an ordinary statement — the
compiler replays it inside the update prelude before DOM writes:

```tsx
export function Badge() {
  let score = 0;
  let tier;
  if (score > 100) { tier = 'gold'; } else { tier = 'standard'; }

  return <span onClick={() => score += 50}>{tier}</span>;
}
```

`score += 50` marks the component dirty; the `if` replays, `tier` updates,
and the text node sees the new value. A `switch` assigning the same
targets on every case works identically.

Branching that picks **markup** becomes a region that mounts and disposes
whole branches:

```tsx
export function Panel() {
  let expanded = false;
  if (expanded) return <article>details…</article>;
  return <button onClick={() => expanded = true}>expand</button>;
}
```

When `expanded` flips, the button subtree is disposed and the article
mounts — the component body itself still ran only once. `if`/`else`
chains, early-return sequences, and exhaustive `switch` returns all lower
to the same anchored region, and each branch may contain its own
components, lists, and nested conditionals.

At module scope the same lowering produces a shared computed, so this
stays in sync for every component that reads `accent`:

```ts
let theme = 'dark';
let accent;
if (theme === 'dark') { accent = '#8af'; } else { accent = '#06c'; }
```

Two boundaries worth knowing:

- **Branches must be pure.** An `if` containing calls or resource work
  isn't replayed — move that logic into `$effect()`. The supported
  conditional form is `if (enabled) $effect(fn)`, which runs the effect
  only while `enabled` holds (see
  [03 — Effects & cleanup](./03-effects-and-cleanup.md)).
- **JSX-returning control flow must be exhaustive** — every path through
  the terminal `if`/`else` or `switch` must produce the branch, because
  the compiler lowers it to one region with a fixed set of alternatives.

## Rendering collections

Map arrays directly; give rows a stable `key`:

```tsx
const todos = [{ id: 1, title: 'a' }];

export function List() {
  return (
    <ul>
      {todos.map(t => <li key={t.id}>{t.title}</li>)}
    </ul>
  );
}
```

`todos.push(...)`, `splice`, index writes — all reactive. Don't accumulate
JSX in a mutable array; map the data.

For closed arrays of plain primitive records with stable keys, the compiler can
refresh only the rows written. Same-row calculations such as
`items[0].label = items[0].label + '!'` keep that precision. Component-owned lists
also support proven bounded loop indices. Getters, unknown producers or calls,
escaped records and cross-row reads keep conservative reconciliation; this is an
optimization proof, not a restriction on ordinary update syntax.

## The mental model

Think of the whole app as a spreadsheet:

- **Cells** = your variables, fields, array elements, Set/Map contents.
- **Formulas** = derived `const` or `let` expressions.
- **The DOM** = cells' display.

You edit cells; the compiler already worked out which formulas and which
pixels depend on which cells, so only those re-evaluate. The only rule that
matters: **mutate the source, never the derived** — and keep everything
reachable through static imports so the compiler can see the whole graph.

Next: [03 — Effects & cleanup](./03-effects-and-cleanup.md)
