# Handlers, writes and mutation

**Folder:** `features/handlers/` _(planned)_.

## What it does

Finds every place that changes state and makes the UI update after it.

## Rules

- **Any function that writes a reactive binding is a handler**: an event callback,
  an effect body, a callback ref, a helper called from them, a `setTimeout`
  callback. `capturesOf(fn)` lists the outer bindings it reassigns. Mutation sites
  come from `core/resolve/`.
- **Any expression is a valid handler**: an arrow, a function name, a member
  (`onClick={actions.go}`) or a call result (`onClick={make()}`, evaluated at
  render). The old compiler rejected the last two.
- **Every method call on state is a possible mutation**, so the state's readers
  update after it. `optimize/read-only-methods.ts` _(planned)_ may say a call does not
  mutate (`items.map`, `items.slice`), which skips that update. A method not on
  that list keeps the general path. It is never rejected.
- Passing state to a function the compiler cannot see is also a possible mutation.
- Writes are batched. The UI updates once the handler finishes, including after
  each `await` in an async handler.
- Each `writes` edge gets a reason id. A site updates only for reasons on its paths.
  This is an optimization (`optimize/reason-routing.ts` _(planned)_); without it the
  general path updates every reader of the binding.

## Inputs and outputs

- In: `Resolved` (reassignment and mutation sites, captures).
- Out: `Handler` nodes and `writes` edges; `EventSite`s in the plan.

## Where to add things

- A new way code can change state (a new syntax form): `core/resolve/` mutation
  sites. Handlers pick it up without changes here.
