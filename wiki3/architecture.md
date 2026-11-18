# Architecture

Status: **proposed**, 2026-11-16. Nothing is implemented. The user accepted the
`.auwla.md` extension and the MDX model with Auwla syntax ([decisions](decisions.md)).

## What documents are for

An interactive docs site: pages written as Markdown, with Auwla components and values
inside, compiled by the compiler like any other module.

1. **Prose first.** Headings, paragraphs, lists, links, tables and code blocks are
   written as Markdown, without quoting every sentence as `.auwla` requires.
2. **Auwla inside.** A page imports `.auwla` components and uses them with Auwla's own
   attribute syntax, and shows values with `{expr}`. Expressions are TypeScript.
3. **Both ways.** A page imports components; a component imports a page.
4. **Static by default** (the least-JS rule). A page with no interactive part compiles
   to cloned templates. Only the embedded components bring code.
5. **Exact positions.** Errors, hover, completion and rename land on the right
   characters of the Markdown file, as they do in `.auwla`.

## The MDX model, our way

| MDX | Documents |
| --- | --- |
| Markdown is the document | Same |
| Top-level `import`/`export` lines are module code | Same rule; TypeScript allowed |
| Components in the flow, block or inline by the same line rule | Same rule |
| A component's children are Markdown again | Same |
| `{expr}` inserts a value, `\{` writes a brace | Same |
| `<tag>` is always JSX, never raw HTML; indented code is off | Same |
| JavaScript expressions | TypeScript, and Auwla's attribute forms inside tags |
| Elements looked up at run time (`props.components`) | Plain tags; replacing them is a compile-time mapping (later) |
| `wrapper` / layout export | Composition: `<DocsLayout><Guide /></DocsLayout>` |
| remark, rehype and recma plugins | Markdown-tree (remark-style) transforms only, if ever |

So existing `.mdx` files with React components or rehype/recma plugins do not run
unchanged, and documents read like MDX.

## Why not compile with MDX

Checked 2026-11-16 against the compiler (scratch tests, not kept):

- **MDX's output defeats static templates.** `@mdx-js/mdx` writes every Markdown element
  as `<_components.h1>`, looked up in `{h1: "h1", ...props.components}`. The compiler
  cannot know those are tags: a heading and a paragraph compiled to 200+ lines of
  component machinery. The same page as plain `<h1>`/`<p>` compiled to one template.
- **Its grammar is not ours.** MDX's parsers reject TypeScript (`export const name: string`),
  `=(expr)` and bare attribute values, read `<div.card>` as a member tag (DX-53 makes it
  a class) and reject `@click`. Plugins run after parsing, so they cannot repair that.
- **Positions come back through source maps**, converted afterwards, where `.auwla` maps
  every copied character exactly.
- **Async plugins.** Most of MDX's plugin ecosystem is async; `toTsx` is synchronous.

## Pipeline

```text
guide.auwla.md
  │  1. pre-scan (ours): code fences, code spans, escapes, ESM blocks,
  │     Auwla elements, {expr}  ── read with JSX+'s own readers
  ▼
shadow text: same length, Auwla regions masked
  │  2. Markdown parser: micromark → mdast (HTML and indented code disabled)
  ▼
mdast with exact offsets  +  the regions read in step 1
  │  3. emit (ours): mdast → plain JSX tags; regions spliced back as TSX pieces
  ▼
TSX module with exact mappings  ──►  the compiler (unchanged pipeline)
```

This is the technique `.auwla` already uses (`masks.ts`, `source.ts`): read the extended
parts with our readers, hide them in a same-length shadow, let a standard parser read the
rest, and emit TSX from pieces that keep authored offsets.

### 1. Pre-scan

A small lexer walks the authored text once and finds what Markdown must never see
([grammar](spec/grammar.md) has the exact rules):

| Region | Found by | In the shadow |
| --- | --- | --- |
| Fenced code, code span | CommonMark's fence and backtick rules | left as is; nothing inside is read |
| Backslash escape (`\{`, `\<`) | the escape | left as is |
| ESM block | a top-level line starting with `import` or `export`, to the next blank line | blanked |
| Block element | a tag starting a line whose closing tag ends one | a marker on its first line, the rest blanked |
| Inline element | any other tag | a same-length marker run, line breaks included |
| Interpolation | `{` outside code, matched with host tokens (`readSubstitution`) | a same-length marker run |

Opening tags are read by JSX+'s `readOpeningTag`, so every Auwla attribute form works
unchanged. The marker is a private-use character, plain text to Markdown. Inline masks
cover line breaks, so an element written across lines cannot end a paragraph.

A block element's body is parsed by the same pipeline from its own offset, so a callout
holds paragraphs, lists and nested components. An inline element's body is inline Markdown.

### 2. Markdown parser

`mdast-util-from-markdown` (micromark) with the GFM extensions: CommonMark plus GitHub's
tables, task lists, strikethrough, footnotes and autolinks. Every node has exact offsets.
Disabled, as MDX does: HTML (`htmlFlow`, `htmlText`), so `<tag>` is always an element,
and indented code, so indented content inside a component stays content. It is pure
JavaScript, synchronous, with no JavaScript parser of its own, and loads lazily at the
first document. micromark is also what MDX uses underneath, so Markdown behaves the same.

A hand-written Markdown parser was rejected: CommonMark's emphasis and list rules are
where they go wrong, and authors expect GitHub's behaviour.

### 3. Emit

- **Markdown nodes become plain tags**: `<h2 id="install">`, `<p>`, `<ul>`, `<a href>`,
  `<table>`, `<pre><code class="language-ts">`, so the compiler clones them from templates.
- **Text becomes JSX text**, not `{"…"}` strings, with `{ } < > &` as entities. JSX text is
  folded into the template; string children are written at run time (below).
- **Regions are spliced back**: an element as JSX+ normalizes it, an interpolation as
  `{expr}`, an ESM block at module level.
- **The module**: ESM blocks in place, a generated `headings` export, and a default-export
  component named after the file ([semantics](spec/semantics.md)).

Copied characters keep their authored offsets, so diagnostics and the language service map
back exactly.

## Where code lives

- **`packages/jsx-plus/src/documents/`**: pre-scan, emitter, language. It reuses JSX+'s
  readers, masks, pieces, diagnostics and checking projection; a separate package would
  duplicate them (DX-31 keeps syntax in this package).
- **the compiler**: one more built-in language beside `.auwla` (`core/parse/built-in.ts`,
  DX-52), so no tool needs an option. Collection, imports, routing, bundling, hot
  replacement and delivery are unchanged.
- **Editor**: the content mapper already serves `normalizeForChecking`'s TSX for `.auwla`;
  documents give it the same shape, so completion, hover, rename and errors work inside
  `{expr}` and on attributes. VS Code associates `*.auwla.md`; highlighting injects Auwla's
  grammar into the Markdown grammar.

## The compiler change this needs (and `.auwla` needs now)

Measured 2026-11-16:

| Source | Template | Text written at run time |
| --- | --- | --- |
| `<p>Hello <b>world</b>.</p>` (JSX text) | `["p", 0, "Hello ", ["b", 0, "world"], "."]` | 0 |
| `<p>{"Hello "}<b>{"world"}</b>{"."}</p>` | `["p", 0, "", ["b", 0, ""], ""]` | 3 |
| `.auwla`: `<p>"Hello " <b>"world"</b> "."</p>` | same as above | 3 |

`.auwla` quoted text normalizes to string children, so every static sentence of an `.auwla`
page is written by code at mount. Folding constant string children into the template, as
JSX text already is, fixes `.auwla` today; documents avoid it anyway by emitting JSX text.
Done 2026-11-16 (slice 0): all three rows now give the first row's template and no writes.
