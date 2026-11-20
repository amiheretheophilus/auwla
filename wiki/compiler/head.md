# Page head

`<head>` written in a component puts its title, meta and link tags in the document's head while the
component is on the page. Search engines and link previews read the HTML the server sends, so the
server writes them there too.

```tsx
function AnalysisPage() {
  const page = $routed(async ({ params }) => loadAnalysis(params.id));
  return (
    <section>
      <head>
        <title>"{page.symbol} · Desk"</title>
      </head>
      …
    </section>
  );
}
```

## What it does

- **Compiler** (`src/features/head/lower.ts`), at parse time after slots (`core/parse/index.ts`,
  `lowerMarkup`): `<head>…</head>` becomes `{$headValue(<>…</>)}`, `headValue` imported from
  `@memoized-dom/runtime`. Only the tags are rewritten, so the content keeps its place and its
  errors their positions. It is then a value its site shows like any other, so the tags follow
  what they read with nothing special in later stages.
- **Runtime** (`runtime/src/head.ts`): the value's program builds the tags in a holder off the
  page and puts nothing where `<head>` was (the site keeps only its own anchor comment). After each
  block mounts, updates or goes away, the head is worked out again. Tags are keyed: `title`,
  `meta[name]`, `meta[property]`, `link[rel=canonical]`. For each key the block of the deepest
  component wins (entity depth), and of two at one depth the later one; other tags all show. In a
  browser the winners are copied into `document.head`, marked `data-mmd-head`. `index.html`'s tag
  for a key a block sets is set aside, a comment keeping its place, and comes back when no block
  sets that key. Once no block is left, the next one reads the head afresh (after hot replacement,
  or another app in the runtime).
- **Server** (`server/src/page-head.ts`, `session.ts`'s `pageHead`): after the first render the
  session reads the winners (`serverPageHead`), and the handler writes them before `</head>`, in
  both deliveries. Streaming waits only for that first render, which runs at once after
  preparation, so `$routed` data is in the title. The template's tag for a key the page sets is
  moved into a `<template data-mmd-head-original>`, which the browser reads back as `index.html`'s
  originals, and the tags the server wrote are dropped there for the blocks' own copies.
- **JSX+** (`jsx-plus/src/styles/scopes/markers.ts`): no scope attribute on `title`, `meta` or
  `link`. Head tags are never shown, so no style applies to them, and in a `<head>` block they
  are copied into the document head. `inspectMarkup` reports each element's tag for this.

## Rules

- `<head>` takes no attributes.
- It holds `title`, `meta` and `link` elements, and expressions (an `if` around a tag). Another
  element stops the build with a message that also catches `<head>` written for `<header>`.
  Text other than whitespace stops it too.
- One `<title>` per `<head>`.

## Limits

- What a block reads after the first render, such as data that settles while the page streams,
  reaches the browser's head when it arrives, not the HTML the server sent.
- A bare `<title>` outside `<head>` is an ordinary element, shown where it is written.

## Cases

- `src/features/head/head.test.ts`: tags reach the head and follow what they read; the deepest
  component wins and what it covered comes back; the head is read afresh after every block is
  gone; a module with no `<head>` is unchanged; the four compile errors.
- `server/tests/page-head.test.ts`: the template's overridden tags are kept, others left alone,
  meta matched by whole value.
- `vite/tests/next-plugin.test.ts`: a dev server sends the page's title in its HTML.
- `jsx-plus/tests/style-scopes.test.ts`: head tags get no scope attribute.
