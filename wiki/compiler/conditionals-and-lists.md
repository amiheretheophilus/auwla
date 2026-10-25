# Conditionals and lists

**Folders:** `features/conditionals/` (expression selectors built),
`features/lists/` _(planned)_.

## What it does

Turns JSX that changes shape (branches, repeated rows) into regions that update in
place.

## Current implementation

| File | What it does |
| --- | --- |
| `features/conditionals/plan.ts` | Plans native ternary/logical selection, primitive fallbacks and independently retained branch templates |
| `features/conditionals/dom.ts` | Emits lazy selection, preserving each logical left operand's single evaluation and its actual falsy value |
| `features/conditionals/returns.ts` | Separates setup from a return-only if/else tail and folds its paths into lazy selection without editing authored syntax |
| `features/conditionals/plan.test.ts` | Selector/branch dependencies and unchanged authored AST identities |
| `features/conditionals/dom.test.ts` | Branch identity, lazy attributes, primitive fallbacks, nested/fragment placement and SVG namespaces |
| `core/emit/sites.ts` | Composes branch templates/sites, guards selector reads separately, updates the active branch and disposes retired collectors/regions |
| `core/emit/render-value.ts` | Hoists a compiled binding program for stored JSX and captures its inputs at the authored expression |
| `packages/runtime/src/render-value.ts` | Mounts captured programs independently per consumer, updates matching programs in place and disposes replaced ranges |
| `packages/runtime/src/list-values.ts` | General first-unused row matching and native array-child traversal: holes, inherited indices and one read per present child |
| `packages/runtime/src/cond.ts` | Existing anchored branch lifecycle; an optional insertion point preserves surrounding sibling order |

Ternary branches and `&&`, `||`, `??` with ordinary left operands are built.
Selector dependencies exclude the JSX leaves' attributes/text, so changing branch
text does not repeat an unchanged condition call. A stable branch updates its
guarded sites and preserves DOM state; a different branch disposes the old sites
and mounts new nodes. Parent disposal drains regions, and retired collectors leave
their parent's ownership set. Primitive fallbacks retain values such as zero.
Branch templates inherit their surrounding namespace and parser constraints.
Root regions use movable fragments so their anchors stay with returned content.
Bare conditional returns and expression-bodied arrows use the same path. A
return-only if/else tail preserves its setup's state across branch swaps. A shared
fallthrough JSX leaf has one branch identity even when reached along different
paths. Four additional native checks and an early-return comparison pass.

Stored/assigned JSX, helper returns, body `if`/`switch` assignments and JSX on
logical left operands now use captured render values. Creating JSX evaluates its
inputs in native order; each consumer mounts independent DOM from a hoisted
program. Updating captures from the same authored JSX retains nodes, while
selecting another program disposes the old range. Namespace selection happens at
mount, so one stored value can be consumed in HTML and SVG. Nested values stay
lazy under native JavaScript control flow.

The planner and emitter use named helpers for selection, return folding, capture
emission and guarded writes. Comments explain why selector inputs exclude branch
sites, why fallthrough leaves share identity and why range cleanup uses anchors.

### Early returns

A body whose returns interleave with setup, or sit in a `switch` or a loop,
compiles to a selector program (`features/conditionals/returns.ts`, `plan.ts`,
`dom.ts`). It follows how the reference runs a body:

- Statements before the first return are setup, as before.
- After that, a top-level statement without a return runs once, the first time
  control reaches it. Consecutive ones form a segment with one `_reached` flag.
  Their declarations are hoisted to the component's scope as `let` (or `var`),
  so every branch and handler sees them; the declaration becomes an assignment.
  A function declaration is hoisted whole, as JavaScript does.
- A memo declared in a segment replays only after its segment has run. Reaching
  the segment settles the memo's snapshots, so the first run is not counted as
  a change. A derived value after a return still follows its inputs:
  `let label = 'middle ' + step` shows the current `step`.
- A statement that contains a return (`if`, `switch`, a loop) is copied as
  written into a native arrow, `_select`, and runs each time the selector's
  inputs change. Each authored `return` gives its branch choice.
- The selector's inputs are the tests, discriminants, loop headers and plain
  statements of those statements. Return arguments record their own inputs, and
  once-only setup is not an input.
- A returned expression that reads a variable declared in the tail's own blocks
  (`case 0: { const label = …; return <p>{label}</p>; }`) cannot be a template
  branch, which is created outside `_select`. It is a captured render value in a
  value branch instead, updated in place while its program stays the same.
- When the body can end without a return, an extra branch shows nothing.
- A `var` inside those statements belongs to the component's scope, so later
  returns and handlers see it: it is declared there and assigned where it was
  written. Each run of `_select` is one run of the authored body, so it starts
  with each such `var` undefined again, as the reference does.
- A return-only tail folds into one `?:` expression only when that selects
  markup. Otherwise (text-only returns, an array return) it is a program too: a
  folded expression is new syntax without an authored position, so its inputs
  could not be found and the view would never update.

Known gap: a hoisted name is `undefined` before its segment runs, where
JavaScript would throw a TDZ error if a handler read it that early.

- **Statements inside a returning block** (`../decisions.md`, 2026-10-24): a
  plain statement there (`if (n > 0) { seen.push(n); return … }`) runs when
  control reaches it and what it reads changed since it last ran, or when it was
  not reached on the previous run. Its own writes do not count, so it cannot
  loop. Statements that declare or use the block's own variables run on every
  run of the block, since the return needs them, and so does anything in a loop.
  compiler-next wraps each such statement in a version guard inside `_select`
  (`ReturningGuard`); hidden reads behind an unknown call are collected while it
  runs and shared with the selector's collector (`computation.share()`). The
  reference does the same with `$ctx.returning`. Before this, the reference ran
  them on every render and never settled.
- A `var` in once-only setup after a return (`for (var i = 0; …)`) is declared in
  the component's scope and derives with its statement, as `let` does
  (`state-and-derived.md`). The reference used to lose it: its setup thunk kept
  the `var`, and it gave no `var` a slot.

Six comparison cases cover the program (`conditional:` in
`cases/conditionals-and-lists.test.ts`): setup after a return, a derived value
after a return, setup between two returns, a switch, block-local markup, and a
return inside a loop. The old compiler fails three of them. The 2026-10-24 audit
added eighteen more: deferred setup that writes state, returns of null, text,
numbers, arrays and markup, `try`/labels around returns, `var` scoping, sibling
order through many toggles, nested regions, SVG branches, falsy `&&` operands,
a stored value consumed twice, fragment roots, derived values between returns,
nested setup between returns, shared fallthrough, switch fallthrough, and
logical/nullish selections. The audit found two bugs, now fixed: the `var`
scope, and a folded tail that never updated.

## Rules

### Conditionals

- `cond ? <A/> : <B/>`, `cond && <A/>`, `??`, `if` with early returns, and `switch`
  all become one `Conditional` region. Early returns are folded into it in
  `plan.ts`, not by rewriting the AST.
- A test may be any expression. A branch is rebuilt only when the chosen branch
  changes; inside a branch, sites update normally.

### Lists

- Array-child traversal captures the length, skips holes, includes inherited
  indices and reads each present value once. Rendering never calls an authored
  array's `map` method. Sparse arrays, duplicate getter reads and overridden
  methods exposed three general-path bugs during optimization preparation; native
  runtime checks and the sparse/overridden-method comparisons retain the expected
  behavior for both compiler strategies.
- **The general rule:** any child expression whose value is an array is a list.
  When what it reads changes, it is evaluated again and its rows are reconciled: by
  `key` when rows have one, otherwise by position. That covers:
  - `items.map(…)`, including callbacks that use the third argument `(item, i, all)`;
  - `load().map(…)` and any other call result;
  - JSX pushed into an array in a `for` loop, then rendered as `{rows}`;
  - `{...items}` spread children.

  The old compiler rejected all four. Built 2026-10-24 (`759c689`) in the value
  slot (`runtime/src/render-value.ts`): an array is a list of rows, each a child
  slot whose range runs from an opening comment to its text anchor. A row
  matches by its element's `key` (captured with the stored JSX), or by position
  without one, as the reference matches children. A matched row is written
  again: the same program updates in place, and another program or a new key
  mounts anew. Unmatched rows are removed, and ranges move into order from the
  end. Nested arrays are nested lists. Markup a conditional cannot template (a
  call or a list) is a value branch. A component used for its value
  (`items.map(Row)`) fails with Phase 6 until components return markup.
- **Fast paths** live in `optimize/` and keep list performance (`../rules.md`,
  rule 6):
  - keyed `.map` over state, reusing rows;
  - targeted `push`, `splice` and `sort`;
  - DOM-only rows.

  Every current list optimization stays until a plan pass reproduces it, and the
  `bench/` numbers are the gate (`../decisions.md`).
- **A `key` outside a list row** (React semantics): a literal key is ignored; a
  dynamic key makes a keyed list of one row, so a changed key remounts. Built:
  in a component template, an element whose key can change is shown through a
  keyed value slot; in stored JSX, a nested element with a non-literal key is.
- Inside a row, the item and index are props of the row. A row's sites update
  like a component's.

## Inputs and outputs

- In: JSX sites from the graph.
- Out: `Conditional` and `List` regions in the plan.

## Where to add things

- A new list operation that can be done faster: an optimization, never a change to
  the general rule.

## Cases to test

In `packages/compiler-next/tests/cases/conditionals-and-lists.test.ts`.

The unchanged full generator saved `tests/corpus/generated-20261021.json`:
`{(0 > 0) ? <b>{0}</b> : <i>{0}</i>}` now passes unchanged on compiler-next.
Six `conditional:` comparisons in this file pass alongside eighteen native
execution checks and one plan check. The full generator still requires Phase 5 list support.
The scoped conditional generator passes 200 programs with seed 20261021. Its
additional state regression, `tests/corpus/conditional-state-20261021.json`, now
passes after correcting resolver target positions (`core.md`). The unchanged full
generator saved a Phase 5 map-chain failure as `generated-20261022.json` (its
shrunk empty-list case now passes alongside the two saved conditional cases); the later
run saves a nonempty list mismatch as `generated-20261023.json`. Both remain
unchanged in the corpus; the full generator is not passing.

The old compiler rejects these:

- `items.map((item, i, all) => …)`;
- JSX pushed into an array in a `for` loop, rendered as `{rows}`;
- JSX assigned in a body `switch`: `switch (mode) { case 'a': view = <p/>; … }`.

These pass today and must keep passing:

- `load().map(…)` over module state;
- `<p key="x">` outside a list, and a dynamic key that remounts;
- maps over module constants;
- filter-then-map;
- `??` in JSX;
- an early return.
- an inline array list reading state;
- `map(Row)` with a function reference;
- literal keys on interactive markup;
- keyed components retaining state on unrelated updates and remounting on key
  changes, including a key on a returned component root;
- keyed host nodes being replaced (asserted by DOM identity);
- keys in conditional branches and component roots.

Two `spread/rest:` cases now cover JSX spread children and pass explicit text/DOM
checks on the reference. Both fail on the old compiler:

| Case | Expected | Old compiler result |
| --- | --- | --- |
| `spread/rest: JSX spread children update and preserve keyed nodes` | Spread stored JSX rows, append a row, and keep the first keyed node | Rejects the stored map with "list rendering must be a direct JSX child" before reaching the spread behavior |
| `spread/rest: JSX spread primitive children retain order and update` | `<p>{...items}</p>` shows `12`, then `123` | Rejects "spread children are not supported" |

Both retain reference output. Compilation rejects them before producing an old
module. These are valid JSX cases required to pass on `compiler-next`.

Old messages not yet checked against valid code: "control flow … test is not
replayable", "conditional cannot choose between two data sources".
