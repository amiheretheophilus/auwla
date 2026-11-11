# Core semantics

0.1-draft, revision 2. Compiler-next's existing rules remain authoritative for
host execution, reactivity, readiness, ownership and delivery.

## Expression children (S-EXPR)

On initial evaluation, child expressions are evaluated in source order with
normal JavaScript values, receivers, short-circuiting, side effects and thrown
errors. Each expression contributes its value at its authored position. Later
re-evaluation follows compiler-next's existing dependencies and scheduling;
"one evaluation" does not mean that a reactive expression is permanently frozen.

```tsx
<p>count + 1</p>
```

has the same value/dependency meaning as existing JSX `<p>{count + 1}</p>`.
`object.method()` keeps its receiver. Optional chains skip their ordinary work.
An unknown helper is accepted and takes the existing conservative path.

An expression's return value is its child value. A side-effecting call returning
a number may therefore display that number, just as it does inside an existing
JSX expression container. The compiler MUST NOT guess that it was intended to be
a statement with no output. Separators and comments contribute no values.

## Text and values (S-TEXT)

Quoted strings use their evaluated host values. Literal quotes are not displayed;
whitespace inside the value is preserved. There is no JSX raw-text trimming or
HTML-entity decoding of a host string. A string containing `<b>` is text, not
markup or an implicit `innerHTML` operation. Server serialization escapes it using
the existing renderer.

Child interpretation otherwise stays with the current runtime: nullish and
boolean values produce no text, numbers including zero do, arrays use existing
child traversal, and captured markup uses existing render-value machinery. The
implementation MUST NOT import JASX's Java child-value conversion rules.

For example, `<p>"&amp;"</p>` has text content `&amp;`; HTML serialization must escape
its ampersand again. `<p>"a\nb"</p>` has an actual newline in its text value.
Trivia between source child items supplies no implicit display space: write
`" "` when a space is wanted.

## Conditional children (S-IF)

At a conditional's position, evaluate its test once for that evaluation. Select
one body and evaluate only its child items, in order. A missing else or an empty
selected body produces no children. Nested conditions follow the same rule.

```tsx
<section>
  if (ready) {
    <p>"Ready"</p>
    count + 1
  } else {
    <p>"Waiting"</p>
  }
</section>
```

is equivalent in child production to existing JSX:

```tsx
<section>
  {ready ? <><p>Ready</p>{count + 1}</> : <p>Waiting</p>}
</section>
```

Only the selected body's expressions run. An implementation may normalize to
equivalent existing conditional/fragment nodes; it MUST preserve the existing
branch update, disposal, ref and readiness behavior. The spec does not require a
particular generated string or a new runtime helper.

This core profile has no new declaration scope: `if` tests/children resolve host
names in their ordinary enclosing scope, and normal functions introduce their
normal scopes. Direct declarations/abrupt statements within child blocks are
deferred. Do not settle those future semantics by wrapping the block in an IIFE.

## Lists and ordinary host forms (S-LIST)

`items.map(item => <li key={item.id}>item.title</li>)` is a normal expression
child. It calls the actual method with ordinary JavaScript arguments and callback
semantics. Existing optimization proofs may select existing row fast paths; an
unknown call is not rejected because its spelling is unfamiliar.

Existing `key={...}` placement, evaluation order and list identity apply. A moved
row keeps exactly the state/refs/resources that the same existing-JSX program
keeps. New direct-loop syntax is a separate future construct; `.map()` does not
wait for it and is not implemented again.

## Existing refs and attributes (S-REF)

`let input: HTMLInputElement | undefined;` plus `ref={input}` already works in
compiler-next. Normalization MUST preserve that binding and reach the existing
ref feature. It does not declare a binding, require a prefix, change assignment
semantics, or install a second ref runtime.

Mount assigns the node, removal assigns `undefined`, and existing ref readers
follow mount/replacement/removal. Forwarding/member/callback behavior and known
limits stay on [the existing ref page](../../wiki/compiler/refs.md). Checks in
this spec verify preservation when new child syntax surrounds a ref.

## Parenthesized attribute expressions (S-ATTR)

`prop=(expression)` normalizes to `prop={(expression)}` with the same value,
evaluation count, ordering and host scope. Its parentheses group comma expressions
and remain copied authored text. Only the enclosing JSX braces are generated.
Nested markup is normalized recursively without moving the expression into a
function or changing valid await/yield contexts.

Other ordinary JSX attributes, spreads and handlers retain their current order
and semantics. Neither `onClick={save()}` nor `onClick=(save())` becomes lazy.
Author a callback, such as `onClick=(() => save())`, for deferred execution.
`ref=(input)` reaches the same existing ref feature as `ref={input}`; no new ref
runtime or target-binding rules are introduced. The separate `@event` proposal
is outside this profile.

## Shared compiler/runtime obligations (S-PIPELINE)

For UI/markup compilation, both source formats MUST use compiler-next's existing
resolution, semantic graph, planning, optimization and emission. The syntax
package normalizes source and supplies authored mappings before compiler-next's
existing parse stage, using its public API without mixing source files.
It MUST NOT add an alternative
dependency engine, interpreter, state container, scheduler or ownership model.

Readiness and update boundaries keep their established rules, including before
`await`. New syntax does not add generated exception wrappers. Static delivery,
SSR and adoption reuse existing contracts; no conformance claim closes the
rewrite's separate Vite, routing, performance or memory gates.

Observable authored side effects must be preserved, while existing compiler
replay rules still determine reactive re-evaluation. When a faithful normalization
has not been found, record that implementation gap rather than silently changing
the semantics or restricting ordinary host expressions.

## Backend authoring direction (planned)

Configured backend `.auwla` files contain ordinary, nonreactive backend code,
including imports of Express and other backend packages. Backend files and/or
folders will be selected through project configuration; the extension alone
does not enable UI derivation, replay or ownership behavior. The reactive rules
above concern UI compilation. Backend configuration/loading remains planned,
and isomorphic support will follow later.
