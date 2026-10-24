# Components

**Folders:** `features/components/`, `features/props/` (general path built).

## What it does

Finds components, and compiles calls to them: props, children and slots.

## Files

| File | What it owns |
| --- | --- |
| `features/components/plan.ts` | Recognizes component calls and spread-bearing hosts that use ordered props |
| `features/components/dom.ts` | Tag evaluation, ordered attributes/spreads, children, and component-value creation |
| `features/components/dom.test.ts` | Native ordering, reserved props, disposal, SVG, direct arguments, opaque tags and shared tag reads |
| `features/props/classify.ts` | Component identities and native parameter bindings |
| `features/props/dom.ts` | Native parameter patterns, defaults/rest, per-binding parent snapshots and prop reception |
| `packages/runtime/src/components.ts` | Props cells, callable adapters, compiled/native tag mounting, generic host props and subtree disposal |
| `tests/generator/components.test.ts` | Generated named/member/factory components with keyed edits, moves, prop updates and removal |

## General path

A call is a render value shown through the existing value slot. The same callable
and key retain an instance; changing either disposes it and mounts another. Each
consumer of stored JSX has its own DOM and component state. Compiled callable
metadata lives in weak collections, outside authored objects. A tag whose body
was not classified as a component is invoked natively, with a collector for its
hidden reads, and its returned value is shown through a slot.

Attributes and spreads evaluate once in source order after the tag. The runtime
extracts `key` for identity and excludes `key`/`suspend` from child props. Explicit
children replace a spread's `children`, using a single value or an array. Native
tag props reuse `patchDomProps`, including listeners batched in the owning
application. SVG flows from the consuming slot through component roots and
conditional fragments; `foreignObject` restarts HTML.

The child keeps native variables and numeric versions. A receiver evaluates the
native parameter patterns into temporaries. A different parent value replaces
that binding and bumps its version; an unchanged value preserves a local
override. Stable object references still notify readers after mutations. Direct
call adapters retain every argument, including map's index/array and rest
parameters. A discarded direct call runs setup without mounting returned markup.

Nested declarations are emitted before their enclosing component is sealed, so
captured parent reads/writes receive the parent's version instrumentation. Local
versions read across an owner boundary publish notifications after the owner
settles. Disposal removes the child entity and its owned collectors and slots.

The reference retains a nested function declaration per setup invocation. Its
previous per-render recreation prevented nested components from settling; the
new nested-component assertion remains unchanged.

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

All twenty current component comparisons pass on compiler-next, including five
new direct-call/import, nested-owner, parameter-pattern and independent-slot
cases. All 64 state/derived comparisons also pass, including deferred prop and
keyed-override cases. Nine native regressions cover observations that do not
depend on the reference. The broad CI audit and Octane gate are tracked in
`../status.md`; this is not a performance claim.

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
- Extend the generated combinations with recursive trees, nested slots, native
  callbacks, computed members and changing captured values. The current component
  generator covers named/member/factory tags, keyed state, spread/explicit props,
  reordering and row removal.
- Expand locally declared component, computed-member and factory combinations;
  the current cases do not establish every callable/tag pattern.
