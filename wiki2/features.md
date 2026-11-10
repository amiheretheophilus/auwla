# Further authoring features

State: proposals and later slices extending compiler-next. Quoted text/direct
children are the new authoring direction in [syntax](syntax.md). Normal refs
already exist and are preserved as mapped in [refs](refs.md).

This page owns the remaining prototype backlog until a feature has enough rules,
files and cases to deserve its own page. Extract it at that point and update the
index; do not leave duplicated contracts here and on the new page.

## Candidates and questions

| Feature / design IDs | Current position | Before a usable slice is complete |
| --- | --- | --- |
| Events, DX-04/05/06/21 | `@click={expression}` is proposed; ordinary `onClick` stays available | Define expressions versus function references/factories, receiver preservation, event typing, explicit parameter scope and DOM/custom-component differences |
| Modifiers, DX-07/08/09 | Guards, listener options and timing are proposals | Define order, argument evaluation, native dispatch-time effects, leading/trailing behavior, async overlap and owner cleanup |
| Bindings, DX-10/11/12 | Named `bind:value` and `bind:checked` are recommended | Define writable targets, composition/reset behavior, types, binding/handler order and SSR/adoption reconciliation; selected-button styling is a separate feature |
| Classes/styles, DX-13 | Conditional class spelling open | Define merge/ownership order, spreads, removal and coexistence with imperative edits |
| CSS, DX-20/24 | Scope/output/tooling open | Define file/component/global boundaries, SSR identifiers, extraction, order and hot updates |
| Hotkeys, DX-16 | Element/region ownership proposed | Define editable-field behavior, focus/modal scope, conflicts, native activation and unregistering |
| Gestures, DX-17 | Pointer-based convenience proposed | Define coordinates, thresholds, cancellation, pointer capture and disposal; reuse normal mutations |
| Observers, DX-18 | Observer convenience proposed | Distinguish visibility state from temporary flags; define options, initial state, pooling and cleanup |
| Async examples, DX-22 | Separate reactive writes from request ordering | Prove stale-response handling and disposal; debounce alone does not define which response may publish |

Detailed original examples and research remain in [dx.md](../dx.md). Its unaccepted
spellings are discussion material; copying one into a fixture does not accept it.

## Acceptance pattern

For any feature selected into a slice, add its exact contract, real/planned file
map and acceptance IDs to its owning page. Include:

- One useful complete example and an ordinary JavaScript/JSX equivalent where possible.
- Initial execution, an update, and teardown or replacement when resources are owned.
- Explicit event/callback timing and evaluation-count assertions where observable.
- Type errors, safe edits and incomplete syntax for its new authored constructs.
- SSR/adoption behavior before making an integration claim.

Event examples use quoted literal children and direct expression children. Normal
refs use `ref={target}`. No feature requires a `$`-prefixed ref or a second state,
mutation or scheduling system.

## First event and binding slices

P5 should settle a small event matrix before introducing modifiers. P6 should
start with a text input and checkbox, checking the write target as well as its
read type. Split either slice if the first counterexample changes the contract.
Other features can be promoted in the backlog when user feedback or prototype
evidence makes them the next useful step.
