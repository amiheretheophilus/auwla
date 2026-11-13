# CSS-2a: compact class conditions

Provisional implemented class-condition profile, 2026-11-13. This extends CSS-1's
explicit global blocks. It does not settle local scope or breakpoint config.

```auwla
<style global>
  .card {
    padding: 4px @.loading:30px;
    color: black @.loading:white @.error:red;
  }
</style>
```

Each declaration has a native property and base value, followed by zero or more
`@.class:value` clauses. The class uses a native CSS identifier, including escapes
and Unicode. The `@.` and identifier are contiguous; CSS whitespace/comments may
separate the identifier and colon. A whitespace or comment boundary must precede
each clause. Values retain CSS strings, comments, functions, URLs and multiline
forms; `@.` inside those lexical contexts is literal CSS. Balanced
token blocks in custom-property values also retain literal `@.` tokens. At the
top level of a value, `@.name` is reserved for the condition grammar. Native declaration
termination applies: semicolons, or the end of a rule for its last declaration.

The generated CSS is ordinary CSS. `.loading` is added to the **rightmost
compound selector**, before any pseudo-element. A selector list is transformed
member by member. `.card > button:hover` becomes
`.card > button:hover.loading`; `.card::before` becomes `.card.loading::before`.
The element with that class controls the condition. No descendant class selector,
CSS runtime, JavaScript evaluator or change to class attributes is introduced.

The base declaration keeps its selector. Conditional declarations appear in their
authored order, with their own native class specificity. Preserve ordering by
splitting the containing rule around each conditional declaration where needed;
do not move all condition rules after later authored nested rules. Ordinary CSS
specificity, layers and order decide overlap. Repeated conditions are allowed.

A final `!important` applies to the whole authored declaration: both the base and
conditional values. It must occur at the end of the chain. Empty base values,
empty conditional values, missing class names/colons and an earlier `!important`
are authored CSS-2a errors. No property aliases or implicit units are introduced.

Syntax/context errors use `CSS2001` at the offending header/value or block opener,
with offsets in the authored `.auwla` text. CLASS-001 through CLASS-012 define
native CSS equivalents and errors; additional tests cover escapes, typing prefixes,
native value edits, real authoring and application of the emitted stylesheet.

Conditions belong directly to a qualified style rule, including such rules under
native grouping at-rules and authored nested selectors. They are not defined in
keyframes, font-face, page descriptors or declarations inherited directly through
a nested at-rule; those uses report a contextual error. Native CSS without the
extension is copied unchanged. Unknown or future native CSS is not rejected just
because it is unknown to this layer.

Editor assistance recognizes the clause as belonging to its native property.
Native value completion and hover remain usable; condition punctuation is not
fed to the CSS service as malformed declarations. Builds remain strict for
malformed clauses, while the checking view retains useful current-source ranges.
Class-name discovery, breakpoint/grouped conditions, aliases and local scope are
later work. Before claiming support, fixtures must cover output, ordering,
selectors, lexical boundaries, errors, real authoring and editor edits.
