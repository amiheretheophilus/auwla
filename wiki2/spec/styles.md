# Native CSS blocks: first profile

Revision: CSS-1, 2026-11-13. Implementation contract for the first styling slice.
The user authorized starting implementation after the CSS design discussion.
The core profile remains revision 8. [styles.cases.json](styles.cases.json) gives
the separately identified CSS-001 through CSS-006 conformance fixtures.

## Boundary

This profile accepts **explicit global, static CSS** in a standalone module-level
block:

```auwla
<style global>
  .card {
    padding: 4px;
    color: var(--foreground, black);
  }

  @media (min-width: 48rem) {
    .card { padding: 30px; }
  }
</style>

export function Card() {
  return <section class="card">"Hello"</section>;
}
```

`global` is required in this first profile. This deliberately leaves the default
and local-scoping contract undecided; it does not choose global as the eventual
default. A module-level `<style>` without `global`, or with additional attributes,
is an authored syntax error. A `<style>` inside returned markup remains an
ordinary DOM element and is not extracted.

Blocks must be complete standalone module items, outside functions, declarations,
expressions and other markup. Multiple blocks concatenate in source order with a
newline between them, forming one stylesheet per module. Normal CSS rules apply
to that combined stylesheet, including placement of `@import` and `@charset`.
CSS relative URLs and imports resolve relative to the owning module's directory.

The body is native CSS, without quoted-text/interpolation rules from template
children. CSS comments, quoted strings and escapes retain their meaning; a
`</style>` within a CSS string or comment does not close the authoring block.
Outside those states, `</style>` closes it. CSS is copied without rewriting
selectors, declarations, keyframes or at-rules. Native CSS semicolons and the
browser's CSS error recovery apply. Editor CSS diagnostics are advisory and do
not turn unknown future CSS properties into compiler errors.

## Delivery and tooling

JSX+ removes the blocks from host code while retaining host mappings. Its pure
source-language adapter returns the stylesheet text. Compiler-next owns the
generated CSS asset, its import, project updates and Bun/Vite delivery. There is
no JSX+ build wrapper, Tailwind dependency, generated style element or reactive
CSS runtime. The single-module JavaScript convenience API alone cannot deliver
assets; use a project/bundler or the detailed module API.

The companion is named `<module-path>.css`, with a generated side-effect import
appended to the normalized host module. Do not create a physical file with that
name. CSS source maps are not provided in this profile; JavaScript maps continue
to point to the authored `.auwla` code.

CSS editor assistance uses a CSS projection separate from TypeScript's checking
view. Completion, hover and validation positions refer to the authored block.
Syntax highlighting embeds CSS rather than treating CSS braces as JavaScript.
An unfinished closing block may project through EOF while typing; builds reject
a missing closing tag at the opening block's authored location.

Editor recovery recognizes a bare property name before `}`, `;` or EOF when the
CSS service reports a missing colon. It reports the error on that property and
rechecks an equal-width view with the unfinished name blanked, so the parser does
not borrow a colon from a later selector. Completion still uses the authored
prefix and edits. Independent errors and genuinely empty-rule warnings remain;
only empty-rule warnings introduced by the checking repair are omitted. Recovery
uses the pinned CSS scanner for strings/comments/escapes and is bounded to eight
passes. Other malformed CSS retains native CSS-service recovery. Production CSS
is unchanged.

## Deferred

Local scope and its selector/keyframe rules are a separate decision. Compact
`padding:4px @md:30px @.loading:40px`, grouped conditions, breakpoint configuration,
future element `.class` syntax and optional property aliases are not accepted by
this profile. They remain planned, in that order, under `dxcss.md`.
