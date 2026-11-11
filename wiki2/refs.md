# Normally declared refs

State: **already implemented in compiler-next**; preserve existing syntax and
behavior when extending markup. There is no new ref implementation task.
Owns DX-19 and the ref-related part of DX-23.

## Authoring contract

This page maps an existing feature and its compatibility checks. The new work
is the surrounding extended syntax and its TypeScript tooling.

Declare a variable and use the existing `ref` prop. Element tags do not declare
variables; no `$` prefix or special ref declaration keyword is introduced.

```tsx
export function Editor() {
  let input: HTMLInputElement | undefined;

  return (
    <section>
      <input ref={input} />
      <button onClick={() => input?.focus()}>"Focus"</button>
    </section>
  );
}
```

The quoted button text belongs to the proposed new format. The variable and ref
prop use the established model: mount assigns the node, removal assigns
`undefined`, and readers follow mount/replacement/removal. A scalar target must
be writable. Scope and shadowing come from the variable declaration.

Member targets, callback refs and forwarding keep their existing contracts and
limitations. Do not invent a second ref runtime or claim a currently unimplemented
callback lifecycle is implemented by the prototype. The existing source of truth
is [wiki/compiler/refs.md](../wiki/compiler/refs.md).

## Existing code map

| Path relative to repository root | Role |
| --- | --- |
| `packages/compiler-next/src/features/refs/classify.ts` | Binding identity and assignable targets |
| `packages/compiler-next/src/features/refs/plan.ts` | Ref writes use existing mutation planning |
| `packages/compiler-next/src/features/refs/dom.ts` | Assignment and forwarding adapters |
| `packages/runtime/src/refs.ts` | Mount, forwarding and teardown |
| `packages/runtime/src/cleanup.ts` | Owner cleanup and failed-setup disposal |
| `packages/compiler-next/tests/cases/refs.test.ts` | Existing comparison cases |

The separate adapter's current ref fixture runs in
`packages/jsx-plus/tests/compile.test.ts`, using the existing implementation.
That package owns new-syntax compatibility tests; it changes none of the existing
ref feature/runtime source files. Broader lifecycle and mapper checks remain open.

## Compatibility checks for the syntax extension

| ID | Expected behavior |
| --- | --- |
| REF-01 | A normally declared target receives its node and can be used in a handler |
| REF-02 | Replacement/removal updates readers and clears the target as the existing runtime does |
| REF-03 | Keyed rows keep their own declared refs on moves and clean them on removal |
| REF-04 | SSR, adoption and failed setup preserve existing ownership and cleanup |
| REF-05 | Rename updates the declaration, `ref={input}` and reads; absence is reflected in types |
| REF-06 | Member/forwarded/callback refs match existing JSX behavior where currently supported |

REF-01 checks that the new frontend reaches the existing ref implementation;
REF-05 checks the new tooling projection. The broader matrix checks existing
lifecycle behavior when new syntax for control flow and delivery is exercised.

## DOM measurements

Declaring a ref does not make a state write synchronously update DOM layout. The
chat-scroll example needs a verified post-update mechanism; do not add a new
flush rule as a side effect of the syntax. Record that mechanism and its ordering
before using it in an application example. Resize is still explicit observation,
not a default dependency of reading a ref.
