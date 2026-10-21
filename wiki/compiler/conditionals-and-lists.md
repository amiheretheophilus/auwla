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

Still pending in Phase 4: stored/assigned JSX, switch returns, setup statements
interleaved with conditional returns, and JSX on the left of a logical operator.
These valid forms still need implementation; lists and component calls remain
their later phases.

## Rules

### Conditionals

- `cond ? <A/> : <B/>`, `cond && <A/>`, `??`, `if` with early returns, and `switch`
  all become one `Conditional` region. Early returns are folded into it in
  `plan.ts`, not by rewriting the AST.
- A test may be any expression. A branch is rebuilt only when the chosen branch
  changes; inside a branch, sites update normally.

### Lists

- **The general rule:** any child expression whose value is an array is a list.
  When what it reads changes, it is evaluated again and its rows are reconciled: by
  `key` when rows have one, otherwise by position. That covers:
  - `items.map(…)`, including callbacks that use the third argument `(item, i, all)`;
  - `load().map(…)` and any other call result;
  - JSX pushed into an array in a `for` loop, then rendered as `{rows}`;
  - `{...items}` spread children.

  The old compiler rejected all four.
- **Fast paths** live in `optimize/` and keep list performance (`../rules.md`,
  rule 6):
  - keyed `.map` over state, reusing rows;
  - targeted `push`, `splice` and `sort`;
  - DOM-only rows.

  Every current list optimization stays until a plan pass reproduces it, and the
  `bench/` numbers are the gate (`../decisions.md`).
- **A `key` outside a list row** (React semantics): a literal key is ignored; a
  dynamic key makes a keyed list of one row, so a changed key remounts.
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
Four `conditional:` comparisons in this file pass alongside six native execution
checks and one plan check. The full generator still requires Phase 5 list support.
The scoped conditional generator passes 200 programs with seed 20261021. Its
additional state regression, `tests/corpus/conditional-state-20261021.json`, now
passes after correcting resolver target positions (`core.md`). The unchanged full
generator saves a Phase 5 map-chain failure as `generated-20261022.json`.

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
