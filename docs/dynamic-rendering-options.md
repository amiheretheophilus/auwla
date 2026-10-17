# Dynamic rendering options

Status: design note, not implemented. Recorded 2026-10-17 so the reasoning is
available when there is evidence to act on.

## Current behavior

The compiler plans every rendering shape at compile time. Each element and
component instance has a static address, and writes are routed to the readers
at those addresses. This is what makes updates touch only the DOM that changed.

Two consequences:

- Lists are live only when written as `.map()` directly in JSX. The compiler
  sees the source, a row template and a key, and emits a keyed list.
- JSX collected into an array by a loop or `push()` is rejected with a
  specific error, because the component body runs once and the loop would
  never run again:

  ```text
  memo-dom: JSX built in a loop or with push() runs once and never updates —
  render lists with items.map(item => <Row key={item.id} />) as a direct JSX child
  ```

Dynamic tags (`const Panel = edit ? Editor : Viewer; <Panel />`) are supported
over a finite set of candidates known at compile time. There is no general
"render any JSX value at runtime" mechanism.

Recursive components compile; their unbounded depth is routed through
`<entry>/**` readers. See `tests/recursive-components.test.ts`.

## Why loops differ from `.map()`

Both produce the same DOM. A `.map()` call is one expression with one row
template and one key. A loop is arbitrary statements:

```tsx
for (const item of items) {
  if (item.hidden) continue;
  rows.push(<li>{item.label}</li>);
  rows.push(<hr />);              // more than one row per item
  others.push(<span />);          // another array
}
rows.sort(byLabel);               // reordered after the loop
```

There is no single row template or guaranteed identity, so a keyed list cannot
be derived from arbitrary loops. The only fully general option is to re-run the
whole block.

## Option A: rewrite simple loops into `.map()`

Recognize exactly this shape and lower it to the equivalent `.map()`:

```tsx
const rows = [];
for (const item of items) rows.push(<li key={item.id}>{item.label}</li>);
return <ul>{rows}</ul>;
```

Conditions for the rewrite: one `for…of` over a source; a body that only pushes
one JSX element into an array declared immediately before; the array is used
only as a JSX child. Anything else keeps the current error.

- Cost: small, compile-time only.
- Trade-off: none for the recognized shape; it becomes the same keyed list.
- Risk: authors may not know which loops qualify; the error must keep saying why
  a loop was not rewritten.

## Option B: explicit dynamic region

An opt-in block (placeholder name `$dynamic`) whose code returns JSX and is
re-run as a whole when anything it reads changes.

Existing pieces it would reuse: static read analysis of derivations,
`$computed` replay entities, conditional and content regions, subtree disposal.
New work: addresses for components created inside the region, and SSR plus
hydration markers for it.

Trade-offs:

- Every re-run rebuilds the whole region; cost follows region size, not change
  size.
- Local state inside the region is lost on re-run: component `let` state, input
  focus and partially typed text, scroll position.
- It must stay explicit and rare. Used broadly, it removes the framework's main
  performance property.

## Evidence that would justify each

- Option A: authors repeatedly hitting the loop error in real applications with
  the simple shape above.
- Option B: a real interface that cannot reasonably be expressed with `.map()`,
  conditions and components, not merely one that is written imperatively.

Until then, the error message is the intended behavior.
