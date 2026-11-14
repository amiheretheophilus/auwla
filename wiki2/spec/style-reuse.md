# Cross-file named styles and native nesting

CSS-3b, working contract dated 2026-11-14. The user authorized implementing
cross-file reuse and implicit native nesting after the CSS-3a checkpoint.
This extends [style-scopes.md](style-scopes.md); component ownership, consumer
scope, explicit globals and definition-only named blocks retain their meaning.

## Source dependencies

```auwla
export function Panel() {
  <style>
    @use("./styles/Cards.auwla", "card-look");
    .title { color: teal; }
  </style>

  return <article class="card"><h2 class="title">"Panel"</h2></article>;
}
```

The compiler resolves the first argument relative to the file containing that
use, using its ordinary source-file resolver (including configured aliases).
The second argument is the exact module-local style ID. No fragments or JS
exports are involved. Transitive uses resolve from their defining file, while
all selected rules acquire the final consumer's scope. Expansion preserves use
order; repeated noncyclic uses are allowed. Duplicate IDs are per file. Missing
sources, missing IDs and cycles report authored file/UTF-16 positions.

A style-only dependency does **not** introduce a JavaScript import. Its own JS
imports are not traversed, its code is not executed, and no JS output is emitted
unless the application also imports that file through JavaScript. The compiler
owns reading/resolution, source caching, updates and bundler watch dependencies.
JSX+ supplies a pure stylesheet recipe and a resolver callback; it creates no
project, bundler plugin or filesystem integration.

Detailed module builds can provide source-only files as `assetSources`, separate
from the JS module set. Projects collect them automatically. The source-language
hook accepts either existing stylesheet text or a recipe with source dependency
specifiers and a pure `render(resolve)` operation. Definition source changes
re-render consumers' CSS without changing stable scope attributes. Vite watches
those sources and sends native CSS updates; Bun builds consume the same compiled
assets. No new Bun watcher or reactive CSS runtime is introduced.

## Relative assets

A relative `url(...)` copied from a definition is rebased from that file's
directory to the consumer stylesheet's directory. Native CSS `@import` string
targets in an explicit global consumer are rebased too. CSS escapes, spaces,
query strings and fragments must survive. Absolute/scheme URLs, root-relative
paths and fragment-only references retain their authored meaning. Same-directory
uses need no rewrite. Resource/global restrictions in CSS-3a still apply.

## Implicit nesting

Both forms are accepted in local and reused rules:

```css
.card {
  .title { color: teal; }
  h2:hover { text-decoration: underline; }
  & > .note { opacity: 0.8; }
}
```

The parser must distinguish selectors such as `h2:hover {...}` from property
declarations, retain declarations before/after nested rules and preserve native
grouping contexts. CSS strings, comments, URLs, bracket/function contents and
custom-property token blocks are not rule boundaries. Native selector/value
parsing remains delegated to CSS Tree; the block reader extends its declaration
versus nested-rule dispatch. The former explicit-`&` restriction is superseded.

Scoping continues to mark declaration subjects with zero-specificity markers.
An ancestor wrapper keeps its unmodified selector context, so nested rules
under `body.dark` can select owned descendants without marking the external body.
This revision adds no property aliases, breakpoint defaults or event syntax.

## Acceptance

Use real nested/multi-file gallery code with two consumers and a transitive
definition in another directory. Check Bun/Vite builds, DOM CSS in both modes,
relative SVG/font/import delivery, project updates, CSS-only hot updates and
source-only files containing JS side effects that must never execute. Verify
cross-file missing IDs/cycles, removal/recovery, resolver aliases, unchanged JS
and stable scope attributes. Parser cases include classes, type/pseudo selectors,
mixed declarations, custom-property braces and inherited grouping declarations.
Editor assistance must not falsely reject valid cross-file `@use` syntax; actual
cross-file source diagnostics require an injected host, not filesystem APIs in
the shared syntax package.
