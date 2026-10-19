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
