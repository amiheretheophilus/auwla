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

## Open questions

- Module-level ref targets (`export let node` with `ref={node}`): readers in other
  modules are not tracked in the old compiler. In the new one they should be,
  through `link/`.
