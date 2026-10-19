# Refs

**Folder:** `features/refs/` _(planned)_.

## What it does

Makes element refs reactive, so a user never needs a ref plus an effect
(`../rules.md`, rule 9).

## Rules

- `ref={box}` is a write to `box`: the runtime writes the element on mount and
  `undefined` when it leaves.
- Markup, derived values and effects that read a ref update when its element mounts,
  is replaced by another branch, or leaves. They do not update on resize
  (`../decisions.md`, 2026-10-18). Resize is an explicit opt-in.
- A ref read only by event handlers costs nothing at mount (`input.focus()`).
- Writes and method calls *through* a ref (`box.textContent = …`,
  `box.classList.add(…)`) are DOM work, not state writes. Only rebinding the ref is
  a write.
- A member ref (`ref={nodes.box}`) writes through its root; `nodes` is ordinary
  state.
- A callback ref (`ref={n => …}`) is a handler: state it writes updates its
  readers. If it reads state, it re-runs when that state changes, running its
  cleanup first (roadmap).
- An effect first runs after its owner's refs have mounted.

## Inputs and outputs

- In: `Resolved` (bindings used in `ref=`), the JSX sites.
- Out: `Ref` nodes; `writes` edges from mount and unmount.

## Cases to test

In `packages/compiler-next/tests/cases/refs.test.ts`. All pass today and must keep
passing:

- a ref used in a handler;
- markup that reads a ref updates when it mounts;
- a ref is cleared when its element leaves;
- a member expression as a ref;
- a callback ref that writes state;
- several refs on one element;
- a ref forwarded through a component.
- a derivation reading a ref on mount;
- ref readers following replacement, removal and remount;
- imperative text written through a ref surviving unrelated renders;
- each keyed row reading its own mounted ref.

The old compiler fails the added case that logs ref identities to a module array
inside an effect: mutating that array re-triggers the effect until the runtime's
cycle guard throws. The reference runs once for mount and once for replacement;
the case asserts both results explicitly. Separate JSX branches keep separate node
identities even when both use the same tag.

## Open questions

- Module-level ref targets (`export let node` with `ref={node}`): readers in other
  modules are not tracked in the old compiler. In the new one they should be,
  through `link/`.
