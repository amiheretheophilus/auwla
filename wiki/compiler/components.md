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

Six further cases check rest-prop forwarding with explicit spread overrides,
dynamic native tags, stateful member tags, distinct same-name factory components,
recursive components with per-node state/remount, and recursive JSX helpers.
All six pass the reference. The old compiler passes rest-prop forwarding, native
tag switching and the recursive component; three cases fail:

| Case | Expected | Old compiler result |
| --- | --- | --- |
| `tag patterns: member components preserve their own local state` | `<Panels.Counter>` keeps edits across unrelated parent updates | Rejects `Panels` as containing JSX but not being a plain function |
| `tag patterns: distinct components with the same name do not share local state` | Switching between factory-created `Counter` functions resets each mount's state | Rejects dynamic `Tag` as having no finite string or linked-component candidates |
| `recursive patterns: recursive JSX helpers update nested arrays and replacement branches` | Native recursion renders `AB`, `ABB`, `ABBC`, then `D` | Compilation does not finish; repeated isolated runs exceed the 15,000 ms guard |

The last fixture has `compileTimeoutMs: 15000`: a synchronous compiler loop cannot
be interrupted by Bun's in-process test timer. This is a diagnostic deadline, not
a benchmark or an expected failure. The original unbounded run was stopped, and
the fixture source/assertions remain intact. All three failures must pass on the
rewrite. The three passing cases have both outputs; the failures have reference
output plus rejection/timeout diagnostics, with no compiled module.

Two assertions also caught reference bugs. Capitalized object-property functions
with JSX block bodies now receive component slots; previously a member component
reset on every render. Authored component calls now match function identity as
well as site/position/key, so different functions named `Counter` do not share
state. Synthesized presentation callbacks retain their established policy slots
as their parent closures are refreshed. Cases and fixes are in
`tests/reference/transform.ts` and `tests/reference/runtime.ts`.

## Open questions

- Which component forms does the old compiler support that are not listed here
  (`page(...)`, presentation components)? Port each with a test.
- Extend generated JSX programs with these combinations, including stateful member
  tags, recursive trees, nested slots, changing captured values, and row removal/remount.
- Expand locally declared component, computed-member and factory combinations;
  the current cases do not establish every callable/tag pattern.
