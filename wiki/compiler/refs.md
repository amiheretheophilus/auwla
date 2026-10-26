# Refs

**Folder:** `features/refs/` (built).

## What it does

Makes element refs reactive, so a user never needs a ref plus an effect
(`../rules.md`, rule 9).

## Files and implementation

- `classify.ts` finds assignable targets, including array entries and member roots,
  and supplies reactive graph facts. Imported member roots also mark their definition.
- `plan.ts` supplies implicit assignments to the existing write and mutation
  emitters; it introduces no second assignment or batching implementation.
- `dom.ts` builds assign/forward adapters from those assignments. An imported
  object's member uses existing mutation observation to reach its defining module
  by object identity.
- `core/plan/model.ts` has `RefPlan` and `RefSite`. Template sites, stored JSX,
  branches and generic spread/dynamic hosts share runtime `mountRef`.
- `runtime/src/refs.ts` owns assignment/forwarding, connected callbacks and
  idempotent teardown. The pending-ref queue delays effects until refs finish.
  Assigned DOM handles are leaves for mutation observation; their implementation
  fields do not become framework state. Rebinding still publishes versions.
- `runtime/src/cleanup.ts` attaches each ref disposer as soon as it mounts, so
  later setup failure clears it too. Early branch disposal detaches that cleanup
  from the owner, preserving idempotence without retaining historical ref nodes.

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

In `packages/compiler-next/tests/cases/refs.test.ts`: 19 reference comparisons,
also run with optimizations disabled. They cover:

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
- connected callback refs before the first effect and callback cleanup exactly once;
- generic spread hosts, exported refs read by another module and imported-object
  member refs feeding a derivation;
- DOM edits preserving imperative text and not rerunning an identity-only effect.

The old compiler fails the added case that logs ref identities to a module array
inside an effect: mutating that array re-triggers the effect until the runtime's
cycle guard throws. The reference runs once for mount and once for replacement;
the case asserts both results explicitly. Separate JSX branches keep separate node
identities even when both use the same tag.

Module-level ref targets read by another module are implemented and covered.
Reactive callback-ref re-execution remains the roadmap item described above;
current callbacks mount once and return cleanup for their element's lifetime.
