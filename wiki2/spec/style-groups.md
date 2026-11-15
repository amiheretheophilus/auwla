# CSS-2c: grouped numeric viewport conditions

Working draft, 2026-11-14. Extends [compact numeric clauses](style-responsive.md)
using the same thresholds: `@700` and `@700px` mean inclusive minimum viewport
width 700px. There is no new configuration, scale or JavaScript evaluator.

DX-50 keeps class groups native: use `&.expanded { ... }` for the same element,
or `.expanded { ... }` for a descendant. No `@.expanded { ... }` group is planned.
Compact `@.expanded:value` clauses retain their existing same-element meaning.

```css
.card {
  padding: 12px;
  @700 {
    padding: 24px;
    display: grid;
    .title { font-size: 1.5rem; }
  }
}
```

## Grammar and native equivalent

A group is `@threshold { native-style-contents }`. The threshold uses CSS-2b's
finite nonnegative number grammar, with implicit pixels or explicit px/em/rem.
No colon follows it. Whitespace/comments may separate the threshold and opening
brace. Both braces are required for a build; unfinished editing retains recovery.

Emit the group in place as `@media (min-width:threshold) { ... }`. Within a
qualified rule, direct declarations inherit that rule's selector; nested selectors
keep native nesting. At stylesheet level, groups contain qualified rules or
further native/numeric groups. A bare declaration there is a contextual error.
Empty groups are valid. Keyframes and descriptor contexts are not supported.
`@use` remains stylesheet-level, not a directive inside a conditional group.

Groups may nest inside each other or native media/supports/container/layer groups.
Their conditions intersect through native CSS: an inner @900 inside @700 applies
when both match. Preserve order; do not sort, merge or hoist thresholds. A later
declaration can override an earlier group with the normal CSS cascade.
The emitter may wrap later inherited declarations in explicit `&` rules. This
preserves that order when a bundler would otherwise collect bare declarations
ahead of nested rules; it does not add selector specificity or a runtime.

Compact numeric/class clauses remain usable within inherited group declarations.
They keep their base-value requirement and declaration-level final `!important`.
Inherited clauses emit nested `&` selectors, not a duplicate descendant selector.
This also supports compact clauses in native nested media/supports groups under
a qualified rule, superseding CSS-2a's initial direct-parent restriction.

The equivalent of `.card { padding:12px; @700 {padding:24px;} }` is native
`.card { padding:12px; @media (min-width:700px) {padding:24px;} }`.
Scoped local selectors, intentional document targets, named-style reuse, URL
rebasing and the compiler's existing CSS delivery keep their current contracts.

## Shared syntax and tooling

Reuse the shared CSS Tree syntax fork for numeric group nodes. Production and
tooling retain original UTF-16 ranges; errors use CSS2001. Tokens in strings,
comments, functions, URLs and custom-property blocks stay literal. Native CSS
without numeric groups keeps its existing behavior.

The CSS checking projection replaces each numeric header with an equal-width
neutral selector, retaining braces and all authored property/value positions.
This is a checking view only; production emits real media queries. Native value
completion, hover and diagnostics must work inside nested groups. TextMate colors
numeric headers, properties, values and nested selectors without capturing literals.

Tests use their own inputs under `tests/fixtures/`, never examples (rule 16).
Keep an editable authoring gallery too. Evidence covers nested/grouped/compact
equivalence, cascade order, malformed thresholds/braces/context, exact editor
edits, both compiler modes, scope isolation, native CSS build and CSS-only HMR.

[GROUP-001 through GROUP-016](style-groups.cases.json) define outputs/errors.
`tests/style-groups.test.ts` executes independent fixture apps, while shared
TextMate tests cover header/body colors and adapter tests probe the built CJS
artifact in Node. A neutral empty group is not reported as an empty ruleset;
ordinary native empty-rule warnings remain visible.
