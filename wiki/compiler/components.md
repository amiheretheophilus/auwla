# Components

**Folder:** `features/components/` _(planned)_.

## What it does

Finds components, and compiles calls to them: props, children and slots.

## Rules

- A component is a function used as a JSX tag. `definition()` finds it in the same
  module or across imports.
- Any tag expression works:
  - `<Box>`;
  - member tags `<UI.Box>`, which the old compiler rejected;
  - dynamic tags (`<Tag>` where `Tag` is state or a prop).
- **Props are one object.** An extra prop the component does not declare is valid
  and simply unused; the old compiler rejected it. Spread props work.
- Each prop is a `Prop` node in the child (`state-and-derived.md`). It is reactive
  when the parent's expression is.
- Children and named slots are plans passed to the child. Render callbacks
  (`render={item => <Row/>}`) are functions that return a plan.
- A component that returns different JSX on different paths gets a `Conditional`
  at its root (`conditionals-and-lists.md`).

## Inputs and outputs

- In: `Resolved`, linked summaries for imported components (`linking.md`).
- Out: `ComponentCall` regions; `Prop` nodes for each component.

## Cases to test

The old compiler rejects both:

- `<UI.Box>`, a member tag;
- `<Child a={1} b={2} />` where `Child` does not declare `b`.

## Open questions

- Which component forms does the old compiler support that are not listed here
  (`page(...)`, presentation components)? Port each with a test.
