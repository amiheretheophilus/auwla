# CSS-2b: compact numeric viewport conditions

Draft contract, 2026-11-14. User direction: `@700` and `@700px` are equivalent.
This extends [class conditions](style-conditions.md), without breakpoint config,
property aliases or a CSS runtime. This slice is compact declarations; grouped
numeric blocks need a separate grammar and are not implemented by this draft.

```css
.card {
  padding: 4px @300:12px @700px:24px;
  gap: 8px @40rem:16px;
}
```

## Grammar and meaning

A compact clause is `@threshold:value`, following a base native CSS value.
The `@` and threshold are contiguous. Whitespace/comments are permitted before
the colon and after it. A whitespace/comment boundary must precede each clause.
Native declaration termination applies: use `;`, except for the last declaration
before `}`. This does not add newline-based declaration termination.

The threshold is a finite, nonnegative CSS number, optionally followed directly
by `px`, `em` or `rem` (ASCII case-insensitive). No unit means `px`. Zero,
fractional numbers and CSS exponent notation are accepted. Negative thresholds,
percentages and other units report an authored `CSS2001` error. Numeric overflow
is an error. There is no threshold scale and no conversion between relative units.
The em/rem unit profile is provisional; the user's required equivalence is pixels.

Each clause means an inclusive **minimum viewport width**, emitted as native
`@media (min-width: threshold)`. It is distinct from container width. `@700`
and `@700px` both emit `(min-width:700px)`. Native media queries remain available
for maximums, ranges, other units and compound conditions. Named `@md` conditions
and grouped `@700 { ... }` forms are outside this slice.

## Cascade, scope and context

Preserve authored clause/declaration/rule order, including repeated or descending
thresholds. Do not sort, merge or hoist queries across later declarations.
Media conditions add no selector specificity. Existing class clauses may occur
in the same chain: they remain independent alternatives, not a combined AND.
Normal CSS specificity, importance, layers and source order decide overlap.
A final `!important` applies to the base and all clauses, as in CSS-2a.

```css
.card { padding:4px @700:24px @300:12px; }
```

At 700px and above, the later 300px clause wins when other cascade factors match.
The generated equivalent, before the existing local-scope transformation, is:

```css
.card { padding:4px; }
@media (min-width:700px) { .card { padding:24px; } }
@media (min-width:300px) { .card { padding:12px; } }
```

Clauses belong to a qualified style rule, including native nested selectors and
rules inside grouping at-rules. Existing surrounding media/container/supports
conditions continue to apply. Keyframes, descriptors and declarations directly
in a nested at-rule retain CSS-2a's contextual errors. File/component scopes,
cross-file named reuse, resource URLs and compiler-owned CSS delivery are unchanged.

## Lexical and tooling obligations

CSS tokens inside strings, comments, URLs, functions, brackets and balanced
custom-property blocks remain literal. Only top-level numeric/class clause
markers in a property value are interpreted. Existing native CSS without
extension markers remains unchanged. Malformed thresholds, missing colons,
empty values/base values and missing braces must keep authored UTF-16 locations.

The shared checking view masks numeric headers at equal width, retaining native
property/value completion and hover at original positions. The shared TextMate
grammar highlights numeric headers without capturing literal contents.
Real authoring checks must exercise viewport boundaries, descending order,
mixed classes, scope isolation, both compiler modes and native CSS build delivery.

[RESP-001 through RESP-018](style-responsive.cases.json) define CSS equivalents
and errors. `packages/jsx-plus/tests/style-responsive.test.ts` consumes the cases
and executes `examples/responsive` at viewport boundaries in both compiler modes.
