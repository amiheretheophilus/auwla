# Conditionals and lists

**Folders:** `features/conditionals/`, `features/lists/` _(planned)_.

## What it does

Turns JSX that changes shape (branches, repeated rows) into regions that update in
place.

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

Not written yet: `<p>{...items}</p>` (JSX spread children). Old
messages not yet checked against valid code: "control flow … test is not
replayable", "conditional cannot choose between two data sources".
