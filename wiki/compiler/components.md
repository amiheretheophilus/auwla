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

In `packages/compiler-next/tests/cases/components.test.ts`.

The old compiler rejects both:

- `<UI.Box>`, a member tag;
- `<Child a={1} b={2} />` where `Child` does not declare `b`.

Passes today: a prop follows the parent.

Six `complex JSX:` cases combine state with fragments, render callbacks, JSX stored
in variables, helper-produced JSX, nested arrays, conditional nodes, spread props,
class-backed keyed rows, and dynamic component tags. Explicit checks verify text,
tag changes, keyed order and retained DOM after row edits/reordering/insertion.
Three pass on the old compiler and three fail:

| Case | Expected | Old compiler result |
| --- | --- | --- |
| `complex JSX: render callbacks combine fragments module state and local state` | Call `render(value)` and update its fragment with module/local changes | Rejects JSX prop `render` as "not rendered by the callee", although the callee calls it |
| `complex JSX: spread props carry class values and setter callbacks to children` | A child callback invokes the setter and changes `A:1` to `A:2` | Keeps showing `A:1` |
| `complex JSX: keyed class-backed rows retain local state through reordering and insertion` | Editing row `a` changes it from `a:v1` to `a:v2`, then state and DOM survive reorder/insert | First edit leaves `a:v1`; later old-compiler steps are not reached |

The reference passes all six. Five have both generated versions in `tests/out/`;
the render-callback rejection has its reference output and the diagnostic above,
with no old compiled module. All three failures must pass on `compiler-next`.
Class/accessor rules, cases and reference snapshot details are on
`state-and-derived.md`.

## Open questions

- Which component forms does the old compiler support that are not listed here
  (`page(...)`, presentation components)? Port each with a test.
- Extend generated JSX programs with these combinations, including stateful member
  tags, nested slots, changing captured values, and row removal/remount.
