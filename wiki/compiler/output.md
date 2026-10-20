# Compiled output

**Status: proposal. Needs the user's yes before Phase 3 of `plan.md`.**

The user: "we have to be at least on par with the current one in terms of perf
whilst being more correct". Emitted code is judged on speed only (`../decisions.md`).

## What the old compiler emits (the speed baseline)

This is the output that ranked second of ten in Octane (`d6e678b`, `testing.md`).
The authored counter:

```jsx
export function App() {
  let count = 0;
  return <button onClick={() => count++}>{count}</button>;
}
```

compiles to (from `packages/compiler-next/tests/out/a-counter/compiled/App.tsx`):

```js
export function App(_id, _parent) {
  const _document = _MD.getActiveEnvironment().document;
  let count = 0;                                   // state is a plain variable

  const _update = () => {                          // sets every dynamic spot
    _MD.setTextData(_text, count);
  };
  _MD.registerEntity({ id: _id, parent: _parent, render: _update });

  const _text = _document.createTextNode('');
  _MD.setTextData(_text, count);
  const _button = _document.createElement('button');
  _button.onclick = () => {
    const _returnValue = count++;
    _MD.invalidateEntity(_id);                     // schedule this component's _update
    return _returnValue;
  };
  _button.appendChild(_text);
  return _button;
}
```

The model:

- **No virtual DOM.** A component is a function that builds its DOM once and
  returns it. Static HTML is a hoisted template (`materializeMarkup`, `cloneNode`).
- **State and derived values are plain JavaScript variables** in that function,
  or module `let`s.
- **One `_update` per component** (an "entity") sets each dynamic spot. Spots skip
  unchanged values (`if (_slot !== value)`). Derived values are recomputed in it.
- **After a write, the handler tells the runtime:** `invalidateEntity(_id)` for this
  component, `commitWrites(['App.tsx#data'])` for module values (an access table maps
  each to the components that read it), `markDirtySubtree` for mutations it could
  not trace. The runtime batches and runs the dirty `_update`s.
- **Lists** are runtime regions (`createListRegion`): keyed reconcile, a row factory
  with its own `update(item)`, delegated events, and fast paths such as selection
  (`refreshKey` on just the rows whose `selected === id` changed). See
  `bench/dom/compiled-inline-app.ts`.

**Why it is fast:** direct DOM writes, per-spot change checks, cloned templates, and
list fast paths. **Why it was wrong so often:** not this model, but the compiler
deciding what to emit. Classification was spread over many passes, so it guessed
wrong about what is state, what re-runs and what to commit. Every failing case in
`tests/cases/` is such a decision. It also emits `try`/`finally` inside list rows,
which `../rules.md` forbids.

## What the test reference emits

```js
const $s0 = $ctx.memo(0, () => [$s1.v], () => 10 * $s1.v);   // recompute when inputs change
```

The reference keeps every value in a slot, re-runs every component after every
event, deep-copies inputs to see what changed, and matches virtual nodes against
the DOM. It is readable and plainly correct, which is its job, but each of those
choices is slow. It never ships (`testing.md`).

## Proposal: the old model, generated from the graph, with explicit memos

**Keep** what the benchmark measured: the runtime package, entities with an
`_update`, plain variables for state, direct DOM writes, templates, list regions
and their fast paths, write commits.

**Change** how it is produced and what `_update` does:

1. **Generated from the plan** (`core.md`): one graph decides what every binding
   is; emit only prints the plan. The authored AST is never edited.
2. **Derived values are explicit memos**, the reference's idea compiled cheaply.
   A derivation is recomputed only when an input changed, checked by **version
   numbers** that writes bump, not deep copies. Its body statements (`if`,
   loops) replay with it.
3. **Writes:** an assignment bumps the version and commits. A known mutating
   method (`push`, `sort`… from `optimize/methods.ts`) does the same after the call.
   An unknown call that receives a value gets the runtime check (copy before,
   compare after), only on that statement.
4. **No `try`/`catch`/`finally`** in output.
5. **Readiness** from the graph's `pending` sets; spots show their `Group`
   policies (`sources.md`).

A sketch for `const total = 10 * qty` (names and helpers are decided in Phase 3):

```js
export function App(_id, _parent) {
  let qty = 1, _qty = 0;                      // value and its version
  let total = 10 * qty, _totalFrom = _qty;    // version `total` was computed from

  const _update = () => {
    if (_totalFrom !== _qty) {                // only when qty changed
      total = 10 * qty;
      _totalFrom = _qty;
    }
    _MD.setTextData(_text, total);
  };
  // …template and register as today…
  _button.onclick = () => {
    qty++;
    _qty++;
    _MD.invalidateEntity(_id);
  };
}
```

Version checks also replace part of today's reason routing: a spot or memo can
skip work by comparing numbers instead of re-evaluating. Whether versions live in
the runtime (per write key) or as emitted locals is a Phase 3 design step.

## Alternatives considered

- **Signals** (Solid style: every value an object, reads become calls). A new
  runtime and no measured baseline. Plain-object mutation (`items.push(x)`,
  `user.name = …`) would need proxies or wrappers, against "write normal
  JavaScript". Not recommended.
- **Ship the reference model.** Correct, but deep copies and re-running every
  component make it far slower than the baseline. Not recommended.

## Open

- The user's yes on the proposal, or another choice.
- Where versions live (runtime write keys or emitted locals), decided by
  measuring in Phase 3.
