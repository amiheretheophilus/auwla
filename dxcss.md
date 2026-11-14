# Auwla CSS developer experience: styling design discussion

Status: native CSS, full-property class/numeric viewport conditions, local scopes,
cross-file named reuse and implicit native nesting are implemented. The wider
design below distinguishes those profiles from later grouping work.

Created: 2026-11-11. Updated: 2026-11-14.

This is the styling companion to [dx.md](dx.md). [wiki2](wiki2/README.md) maps the
prototype; [the language spec](wiki2/spec/README.md) owns implemented grammar and
conformance. [CSS-1](wiki2/spec/styles.md) defines the narrow implemented profile;
this document retains the wider direction and unresolved questions.

## 1. Current direction and sequence

Start with **native CSS property names and native CSS values**. Tailwind is
removed from the target design. Optional property aliases such as `p`, `px`
and `bg` come later.

The agreed sequence is:

1. Ordinary CSS in style blocks.
2. Compact and grouped conditions on ordinary CSS properties.
3. Optional property aliases after the native CSS foundation.

Editor support accompanies each usable slice. CSS-1 extracts explicit module-level
`<style global>` blocks and provides native CSS assistance. Compiler-next delivers
the resulting companion stylesheets through its existing Bun/Vite integrations.
CSS-2a now implements compact class conditions on full properties, including
`padding:4px @.loading:30px`, with native value assistance and header highlighting.
[CSS-3a](wiki2/spec/style-scopes.md) adds local-by-default file/component styles
and named reuse with `@use(path, id)`. [CSS-3b](wiki2/spec/style-reuse.md) adds
cross-file dependencies, resource rebasing and implicit nesting. CSS-2b now
uses numeric viewport thresholds: `@700` equals `@700px`, without named-breakpoint
configuration. See [CSS-2b](wiki2/spec/style-responsive.md). Grouping and aliases
remain later work; named breakpoints are optional future design.

Follow DX-39: JSX+ is a standalone template/source-language layer. It supplies
syntax transformations through `auwla`; compiler-next owns projects, applications,
imports, build delivery, source maps, HMR and bundler integrations. JSX+ must not
grow another project wrapper, build graph, Bun/Vite plugin or build-map composer.
Its source implementation uses no Bun/Node APIs.

## 2. User directions and open choices

| Topic | Direction | Status |
| --- | --- | --- |
| Native CSS first | User: "we will start wit the normal css then later we add the short hands like p and co" | Required sequence |
| Tailwind | User plans to drop Tailwind and use native CSS | Removed from this layer; supersedes the earlier provider proposal |
| Full-property conditions | Conditions apply to `padding` and other native properties, not only future aliases | Required design direction |
| Numeric responsiveness | `@700` and `@700px` mean the same viewport threshold | Accepted 2026-11-14; inclusive minimum width; no breakpoint configuration |
| Compact spelling | `@condition:value` follows its property, without quotes | Required candidate spelling |
| Class conditions | User proposed `p:4 @.loading:30`; the element carries the class | Required direction; first examples use full CSS properties |
| Element classes | Dot-style `.class` authoring on elements is planned, including conditional classes | Exact element grammar remains open |
| CSS execution | Style conditions compile to CSS; the browser applies them | Architectural requirement; no CSS runtime |
| Grouping | Blocks group several changes under a condition | Planned authoring form |
| Local scope | Local-by-default `<style>`, explicit `<style global>` | CSS-3a implements file/component scopes with static subject markers |
| Named styles | `<style id="...">`, consumed through `@use(path, id)` | Same-file/cross-file reuse, transitive IDs, resource rebasing and compiler-owned source watching implemented |
| Separators | Native CSS declaration termination for compact chains | Semicolons, except the final declaration before `}`; newline-only convenience remains unimplemented |
| Editor support | Completion, highlighting, hover and diagnostics | Native value assistance and class/numeric header highlighting built; desktop acceptance remains separate |

These directions do not choose named breakpoint defaults, alias
values or a selector-rewriting algorithm. In particular, future `p:4` has no
agreed unit/scale meaning. Dropping Tailwind does not silently turn it into `4px`.

## 3. First foundation: ordinary CSS

The initial authoring target uses ordinary declarations:

```tsx
<style>
  .card {
    padding: 1rem;
    color: var(--card-text);
    background-color: white;
    display: grid;
    gap: 1rem;

    &:hover {
      border-color: rebeccapurple;
    }

    @media (width >= 48rem) {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>

export function Card() {
  return <article class="card">"Hello"</article>;
}
```

This foundation is implemented, including local file/component scopes. Native CSS
properties, units, functions, variables, selectors and at-rules remain available.
There is no utility scale for ordinary properties such as `padding` or `gap`.

Static blocks can be declared at module level or directly in a component body.
A `<style>` returned inside markup remains an ordinary DOM element. Style-like
text in JavaScript strings/comments remains host content; the delimiter scanner
preserves quoted/commented CSS closers.

Initial recommendation: static blocks. They do not implicitly capture component
locals or inherit quoted-markup interpolation. Dynamic values continue through
existing inline styles/CSS variables. Future CSS interpolation needs its own
typing, evaluation, ownership and SSR contract.

## 4. Compact conditions on ordinary properties

The next step adds conditions to those native declarations:

```css
.button {
  padding:4px @700:30px @.loading:40px;
  color:var(--button-color);
}
```

Each continuation inherits the property on that entry. Spaces after either
colon are allowed: `padding:4px @700:30px` and `padding: 4px @700px: 30px` mean
the same thing. Values remain CSS, including functions and lists:

```css
.card {
  margin-inline:auto @1000:2rem;
  grid-template-columns:1fr @700:repeat(2, minmax(0, 1fr));
}
```

Full-property conditions are required in the condition slice. They do not wait
for aliases. An `@` inside strings, comments, URLs or balanced functions is not
automatically a condition. Custom properties can contain arbitrary tokens and
need explicit fixtures so their values are not accidentally split.

## 5. Responsive and grouped conditions

Compact form:

```css
.card {
  padding:4px @700:30px @1000px:40px;
}
```

Future grouped equivalent, preserving rule order (not part of the compact slice):

```css
.card {
  padding: 4px;

  @700 {
    padding: 30px;
  }

  @1000px {
    padding: 40px;
  }
}
```

Groups may contain several declarations and nested selectors. Both forms should
share one condition representation and emit equivalent CSS when order and
declarations are equivalent.

| Form | Intended meaning | Status |
| --- | --- | --- |
| Base declaration | All viewport widths | Implemented |
| `@700` / `@700px` | Inclusive minimum viewport width of 700px | Accepted compact slice; equivalent spellings |
| `@40rem` / `@40em` | Minimum viewport width in native relative units | Provisional unit profile |
| Named thresholds / maximums / ranges | Additional convenience forms | Later design; native media queries already available |
| `@media (...)` | Native media query | Preserve native CSS |
| `@container (...)` | Native container query | Preserve native CSS; distinct from viewport conditions |

Numeric thresholds require no configuration. A missing unit means pixels;
explicit `px` means exactly the same thing. Thresholds are nonnegative finite
CSS numbers; this compact profile also accepts `em` and `rem`. They apply to
viewport width, not container width. Preserve authored order rather than sorting
thresholds, so overlapping clauses follow the native CSS cascade.

Native `@media`, `@supports`, `@container`, `@layer` and other at-rules remain
distinct from compact numeric conditions. Group grammar, module-level placement
and combined-condition spelling still need review. Compact clauses remain
independent alternatives when mixed with class clauses, not an implicit AND.

## 6. Author-controlled class conditions

The user's `p:4 @.loading:30` idea also applies to full property names:

```css
.button {
  padding:4px @.loading:30px
}
```

Conceptual output before any local-scope transformation:

```css
.button {
  padding: 4px;
}

.button.loading {
  padding: 30px;
}
```

`@.loading` matches the same element targeted by this rule when it also has
the `loading` class. It is not an implicit ancestor or descendant condition.
Complex selector lists need their own transformation examples.

Grouped class condition:

```css
.button {
  @.loading {
    padding: 30px;
    opacity: 0.5;
  }
}
```

Classes can be static or controlled using existing authoring:

```tsx
<button class=(loading ? "button loading" : "button")>
  loading ? "Saving…" : "Save"
</button>
```

Later dot-style class syntax on elements must produce the same ordinary DOM
classes. This document does not choose its exact static/conditional grammar.
The element side controls class membership; the stylesheet selects that class.
Ancestor, descendant, attribute and arbitrary-selector conveniences would need
separate rules.

Hover/focus/disabled and dark-mode conditions remain further candidates. Specify
whether `@hover` means raw `:hover` or also a hover-capability media guard, and
whether dark mode follows a media query or a project selector.

## 7. Compile-time CSS and existing compiler ownership

The CSS layer produces CSS assets at build time. For example,
`padding:4px @700:30px @.loading:40px` becomes:

```css
.button {
  padding: 4px;
}

@media (min-width: 700px) {
  .button {
    padding: 30px;
  }
}

.button.loading {
  padding: 40px;
}
```

The browser evaluates the query and selector. There is no CSS runtime, JavaScript
condition evaluator, resize listener or component replay for these rules.
Application JavaScript may update a class or inline CSS variable through existing
reactivity; that is separate from CSS matching.

Responsibilities:

1. JSX+ parses style syntax and emits CSS text plus syntax-origin information.
   It handles the selected local selector/element-marker transformation.
2. Compiler-next receives static assets through a generic language contract and
   owns their project integration, composition, ordering and delivery.
3. Existing Bun/Vite integrations consume compiler output for extraction, HMR and
   production assets.

The current source-language hook returns TSX and an origin. Any missing CSS
asset capability must be designed in compiler-next's generic hook under DX-34.
Do not work around it with JSX+ project wrappers, filesystem writes, bundler
plugins, full-build map composers or per-component runtime style injectors.

SSR must deliver CSS without `document`. Scope identifiers must match between
server and client, independent of absolute checkout paths. Static module CSS is
shared across repeated instances. Ordering, deduplication, lazy assets, imported
URLs, adoption and HMR require real acceptance through existing compiler tooling.

## 8. Accepted scope direction and named styles

The user has defined the ownership direction (DX-45): a style declared inside a
component belongs to that component. Putting a style at module/file level makes
it shareable by components there. Plain styles are local; `global` explicitly
makes their rules global. [CSS-3a](wiki2/spec/style-scopes.md) now implements
component/module scopes; CSS-3b adds cross-file reuse and implicit nesting. The draft separates
the accepted direction from provisional declaration/selector choices.

```tsx
<style>
  .card { padding: 1rem; }
</style>

<style global>
  body { margin: 0; }
</style>
```

No `scoped` keyword is required. `<style id="card-look">` names a reusable style
block. The user confirmed that importing this block into another component makes
its rules apply to that consumer's own elements. For example, `.card { padding:16px; }`
can be explicitly used by two components and style each one's `.card` in its own
scope. The user chose `@use("./Cards.auwla", "card-look");`, without `#` fragments,
keeping native CSS `@import` separate. Named blocks are provisionally definitions
that apply only through a use. IDs are module-local style names, not DOM IDs or
JavaScript exports. Cross-file resolution uses compiler-next's project and
watching, with relative asset URLs rebased from the definition's directory.

The first slice settles direct function-body declarations, module sharing,
missing/duplicate/cyclic same-file uses, zero-specificity subject markers,
nested/imported boundaries and authored slot content. Named CSS resources such
as keyframes/font faces provisionally require an explicit global consumer.
The gallery is [examples/scoping](packages/jsx-plus/examples/scoping/README.md).
The shared CSS Tree block reader now recognizes implicit class/type/pseudo
nesting as well as explicit `&`. It preserves custom-property blocks, functions,
comments and declaration order; there is no separate selector/value parser.
Remaining design/integration work:

- Cross-file editor source/ID discovery and diagnostics through an injected host;
  shared native CSS assistance currently defers external lookup without false errors.
- Named resources local to a scope, global/deep escapes and explicit portal cases.
- CSS source maps and native browser acceptance beyond the existing DOM tests.

Local selectors do not provide Shadow DOM isolation. Inheritance, custom
properties, global rules and the normal cascade still apply. Class conditions
must match the names produced by element authoring.

## 9. Separators, full values and the cascade

Explicit document subjects (`:root`, `html`, `body`, including qualified and
mixed selector forms) keep their document meaning inside a local block. Do not
require component markers on the document shell. `:root` variables and `body`
typography therefore work beside scoped component rules. Descendant subjects
such as `body .card` still scope `.card`; explicit document targets do not make
the whole block global. This fixes the user's stress-test page without rewriting
their authored CSS. See [scope semantics](wiki2/spec/style-scopes.md).

Implemented rule: native CSS semicolon/closing-rule termination ends a compact
chain. A newline alone does not. Track strings, escapes, comments, parentheses
and brackets so nested content is not split. Semicolons permit multiple entries on one line:

```css
.card { padding:4px @700:30px; margin-inline:auto @1000:2rem; }
```

Ordinary declarations without compact conditions retain CSS termination rules.
Do not treat every newline as a semicolon or break multiline values:

```css
.card {
  grid-template-columns:
    minmax(0, 1fr)
    16rem;
}
```

Comment behavior, continuation, custom-property tokens, `!important` and value/
condition boundaries require formal fixtures.

Preserve authored declaration/rule order. Native specificity, importance, layers
and source order decide overlapping matches. `.button.loading` has different
specificity from `.button`; putting a breakpoint later does not guarantee it
wins. Review overlap examples instead of inventing runtime precedence.

Check repeated/reversed conditions, native shorthand/longhand interactions and
nested conditions. Any restriction or warning needs a documented reason.

## 10. Property aliases later; Tailwind removed

Aliases come after ordinary CSS, conditions and tooling have a stable contract.
Illustrative future mappings include `p` to `padding`, `px` to explicitly chosen
horizontal properties, and `bg` to an explicitly chosen background property.
The table, collisions and value grammar remain open.

`bg` must not silently alternate between `background` and `background-color`.
Unitless `p:4` has no agreed interpretation. Alias units/scales must be reviewed
later; native custom properties can already name project values.

The earlier Tailwind provider, utility candidate expansion, `@apply`/`@reference`
integration, Tailwind theme resolution and source-scanning plans are superseded.
No Tailwind dependency or provider layer is planned. Applications may choose
third-party CSS independently, but this CSS contract stands on native CSS.

## 11. Completion, highlighting, hover and diagnostics

Coloring and language assistance are separate deliverables. A CSS-colored region
does not automatically provide completion, and the TypeScript mapper is not a
CSS engine. Compilation and tooling should share the style syntax model.

| Cursor context | Planned assistance |
| --- | --- |
| `padd…` | Native properties such as `padding` |
| `padding:…` | CSS values, units and functions |
| `var(--…)` | Discoverable custom properties |
| `padding:4px @…` | Numeric thresholds and class forms; header suggestion discovery remains later |
| `padding:4px @700:…` | Native CSS padding values; implemented with original completion-edit ranges |
| `@.load…` | Discoverable author classes; arbitrary class names remain usable |
| `class="ca…"` | Local class candidates where safely identifiable |

A reusable CSS language service can handle native CSS; our extension must
explicitly handle compact conditions. Hover can explain a property's value,
the numeric condition and emitted CSS (condition-specific hover remains later).
There is no Tailwind completion provider.

Keep current-source checking useful for `padding:4px @`, `padding:4px @700:` and
unfinished blocks. Do not reuse stale successful text. Map completion edits,
diagnostics and hover ranges back to the author, rejecting unsafe edits across
generated-only spans. Nearby TypeScript assistance must survive CSS errors.

Formatting must preserve the extension and ordinary CSS strings, comments,
functions and multiline values. Shared syntax-origin data and CSS assistance
remain independent of editor SDKs; thin per-editor adapters route requests.
Test real editor behavior alongside service checks. Diagnostic codes and recovery
limits belong in the formal spec when a slice is selected.

## 12. Slices after design review

| Slice | Outcome | Evidence |
| --- | --- | --- |
| CSS-0: design/spec | Reviewed scope, grammar, examples, errors and ownership | CSS-1 profile and CSS-001 through CSS-006 fixtures written; wider syntax remains a design discussion |
| CSS-1: ordinary CSS | Full native declarations in explicit global style blocks | Implemented and verified: real example, CSS output, authored ranges and baseline editor support; local scope deferred |
| CSS-2: conditions | Compact conditions on native properties, including author classes | `padding:4px @700:30px` equals `@700px:30px`; class clauses, equivalent output, thresholds, overlap and applied completion edits. Grouped numeric blocks remain next |
| CSS-3: integration | Static CSS through compiler-next delivery | Builds/HMR, URLs, lazy assets, SSR/adoption, deduplication, maps and desktop checks as applicable |
| CSS-LATER: aliases | Optional `p`, `px`, `bg` conveniences | Separately reviewed mappings, units, collisions and completion; no Tailwind dependency |

Split condition categories when their contracts need separate review. Aliases
are not a prerequisite for full-property conditions. Editor work accompanies
each usable syntax slice; production readiness also needs delivery acceptance.

Syntax ownership is `packages/jsx-plus/src/styles/`, with shared editor assistance
and `examples/styling/`. The authorized first implementation extends the compiler's
generic source-language hook for native CSS companions, recorded for reconciliation.
The wider shortcuts remain planned; documenting a later slice does not authorize it.

## 13. Before coding

Review the selected slice's input examples and exact expected CSS, including:

- Local/global ownership, selector specificity, component boundaries and markers.
- Breakpoint configuration, condition names/placement and same-element classes.
- Multiline values, strings/comments/functions/URLs, custom properties, separators
  and missing-token recovery.
- Overlap, authored order, layers and importance.
- The generic CSS-asset contract and authored error/origin handling.
- Actual applied completion edits with LF/CRLF and emoji; neighboring TypeScript
  remains usable.
- Browser styles while resizing/changing classes; static SSR CSS, repeated mounts,
  hot updates and lazy delivery.

Use real authoring and browser/editor evidence. Mocks or snapshots alone do not
establish the user experience. Keep assumptions separate from reviewed rules and
review readable code directly when implementation is authorized.

Implementation begins only after the user asks for it. This document does not
authorize starting a CSS compiler, adding dependencies or changing runtime behavior.
