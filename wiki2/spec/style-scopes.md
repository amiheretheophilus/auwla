# Local styles and named reuse

Profile CSS-3a, draft dated 2026-11-14. DX-45 supplies the accepted ownership
direction. The user chose **`@use(path, id)`**, with no `#` fragment. The rules
below make a first implementation slice reviewable; choices labelled provisional
can change as we exercise real examples.

## Authoring and ownership

```auwla
<style>
  .file-label { font-weight: bold; }
</style>

<style id="card-look">
  .card { padding: 16px @.expanded:32px; }
</style>

export function Card() {
  <style>
    @use("./Cards.auwla", "card-look");
    .title { color: navy; }
  </style>

  return <article class="card"><h2 class="title">"Card"</h2></article>;
}
```

* A standalone module `<style>` applies to native elements authored in that
  module, including its several components. It does not select DOM authored by
  an imported component, even if that component uses the same class names.
* A standalone `<style>` directly in a function body belongs to that function's
  component. Inline callbacks, direct loops and fragments inherit this scope.
  A nested component is an ownership boundary, even without its own style block.
  An explicitly styled function is also a boundary; imported callers need not be
  present for its styles to compile correctly.
* A style declaration is static. It does not execute when a function runs. A
  declaration inside a conditional or loop is an error in this first profile.
  Use normal classes and native CSS conditions to select appearance at runtime.
* `<style global>` leaves selectors global, whether declared at file level or
  directly in a function body. It is emitted once with the module's stylesheet.
* A `<style>` **inside returned markup**, an initializer or another element is
  still an ordinary DOM style element. It is not a static style declaration.
  The distinction is statement placement, not the text `style` alone.

Provisional declaration grammar: only the boolean `global` attribute or a
nonempty quoted `id` is accepted. They cannot be combined. Named blocks are
module declarations, so sharing is explicit rather than exporting a component's
private block.

## Named styles and `@use`

Provisional: a named block is a **definition**, not an automatically applied
stylesheet. An unnamed style opts into it with:

```css
@use("./Cards.auwla", "card-look");
```

Both arguments are CSS strings. The path identifies a source module, including
the current module for same-file reuse. The second argument is its exact style
ID; it is not a URL fragment, JS export or class selector. Ordinary CSS `@import`
retains its native role and is not an alias for `@use`.

Rules are inserted at each `@use` in source order and acquire the **consumer's
scope**, not the definition's scope. A file-level consumer shares those rules
within its file; a component consumer keeps them private; an explicit global
consumer makes them global. A definition can use another definition. Duplicate
IDs, missing IDs and cycles are authored errors. Repeated noncyclic uses are
allowed and preserve cascade order. `@use` is a top-level stylesheet directive,
not a conditional/nested rule or runtime expression.

First slice: same-file uses with a relative path that resolves to the current
file. Cross-file reuse needs compiler-owned source-dependency resolution and
watching; it must not be implemented as a JSX+ project wrapper or a JavaScript
import that executes the definition module. Until that slice lands, a cross-file
use reports an explicit unsupported dependency error. Relative asset URLs keep
their source directory; rebasing is an acceptance requirement for that slice.

## Static CSS transformation

Each eligible native element receives a deterministic static attribute. A local
declaration selector gains `:where([data-mmd-s-…])` on its subject (the last
compound), before any pseudo-element. `:where` contributes zero specificity. Ancestor qualifiers
such as `body.dark .title`, selector lists, `:is`/`:not`/`:has`, grouping rules
and native nesting keep their CSS meaning. A rule with nested selectors retains
its original ancestor context; its own declaration groups are scoped through
nested `&:where(...)` rules, preserving order around child rules and grouping
conditions. Thus `body.dark { & .title {...} }` does not suddenly require a marker
on `body`. Nested declaration subjects are scoped too, so an unmarked child
component cannot accidentally match a descendant rule. Local selectors and
structural braces must be complete for safe rewriting; globals keep native
CSS recovery. Editor assistance still accepts unfinished local CSS while typing.

CSS Tree 3.2's block grammar recognizes nested rules beginning with `&` but
falls back to raw text or declarations for implicit forms such as `.child {...}`
and `h2:hover {...}`. **Local nesting therefore requires explicit `&` in this
first slice.** Both fallbacks are rejected, preventing accidental unscoped rules.
Global blocks still pass native implicit nesting through unchanged. Full native
implicit nesting needs a parser capability upgrade, not silent scope leakage.

The module path and function ordinal determine the attribute, not CSS contents
or source byte offsets. A CSS-only edit keeps existing DOM valid. Server and
client compilation use the same rule. A scope belongs to a definition, not an
instance; two instances still select the same rules. Compiler-next remains
responsible for ordinary state, events, refs, DOM creation and SSR.

Provisional first-profile limits: native `@import`, named resources such as
`@keyframes`, descriptor rules such as `@font-face`, and other at-rules whose
scoping is not defined here require an explicit global consumer. The compiler
must not silently emit an unscoped resource from a local block. Native selector
grouping (`@media`, `@supports`, `@container`, `@layer`, `@starting-style` and
`@scope`) is supported. No keyframe-name rewriting or global escape syntax is
invented. Native properties, custom properties and values remain native CSS.

Projected children keep their author's scope. Ordinary inherited properties can
cross component boundaries, as they do in CSS. These attributes are selector
boundaries, not Shadow DOM, security isolation or a way to block inheritance.
Dynamic HTML inserted as a string has no authored-element marker.

## Evidence required

Diagnostics use authored UTF-16 spans, including errors in reused definitions:

| Code | Meaning |
| --- | --- |
| CSS1001 | Unsupported style attributes, empty ID or component-private named definition |
| CSS1002 | Missing authoring `</style>` (existing CSS-1 rule) |
| CSS1003 | Static declaration in a conditional/loop/nested statement block |
| CSS2001 | Invalid class condition (existing CSS-2a rule) |
| CSS3001 | Malformed `@use`, duplicate/missing ID, cycle or unresolved cross-file dependency |
| CSS3002 | Unsupported local resource, implicit nesting or incomplete structure/selector |

The shared CSS editor service reports same-file use syntax/ID errors alongside
native CSS assistance. Scope transformation restrictions (CSS3002) are currently
build diagnostics; editor checking deliberately retains incomplete native CSS.

Exercise actual example files with same-name sibling/nested/imported components,
module sharing, private overrides, named/transitive uses and ordinary conditional
classes. Apply the emitted CSS to the executed DOM in both compiler modes; check
computed properties and user interactions. Check slot fallback/projected content,
SVG, selector specificity, pseudo-elements, grouping/nesting, stable attributes
on CSS edits, SSR parity, source mappings and authored errors. CSS completion,
hover and highlighting must work inside component and named blocks as well as
global blocks. Cross-file delivery and editor resolution are separate claims.

[SCOPE-001 through SCOPE-010](style-scopes.cases.json) fix the declaration,
sharing, explicit-use, unused-definition and early-error examples. Runtime,
selector, slot, SSR and editor evidence lives in `tests/style-scopes.test.ts`;
real TextMate tokenization is checked in `tests/editor-assets.test.ts`.
