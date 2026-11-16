# Documents: Markdown pages with Auwla components

Status: **proposed architecture**, 2026-11-16. Nothing here is implemented. It
replaces the draft at the repository root (`mdx-research.md`). Decisions the user
still has to make are listed at the end; the spec (DX-29) follows them.

## What we want

An interactive docs site: pages written as Markdown, with Auwla components and
values inside them, compiled by compiler-next like any other module.

1. **Prose first.** Headings, paragraphs, lists, links, tables and code blocks are
   written as Markdown, without quoting every sentence as `.auwla` requires.
2. **Auwla inside.** A page imports `.auwla` components and uses them with Auwla's
   own syntax (`=(expr)`, bare values, class shorthand and `@` events once they
   exist), and shows values with `{expr}`. Expressions are TypeScript.
3. **Both ways.** A page imports components; a component imports a page.
4. **Static by default** (the least-JS rule). A page with no interactive part
   compiles to cloned templates and ships as HTML. Only the embedded components
   bring code.
5. **Exact positions.** Errors, hover, completion and rename land on the right
   characters of the Markdown file, as they do in `.auwla`.

## Why not compile with MDX

Checked on 2026-11-16 against compiler-next (scratch tests, not kept):

- **MDX's output defeats static templates.** `@mdx-js/mdx` writes every Markdown
  element as `<_components.h1>`, looked up in `{h1: "h1", ...props.components}`, so
  pages can swap elements at run time. compiler-next cannot know those are tags.
  Each became a dynamic component value watched for changes: a heading and a
  paragraph compiled to 200+ lines of component machinery. The same page as plain
  `<h1>`/`<p>` compiled to one cloned template.
- **Its grammar is not ours.** MDX's JSX and expression parsers reject TypeScript
  (`export const name: string`), `=(expr)` and bare attribute values. They read
  `<div.card>` as a member tag (DX-53 makes it a class) and reject `@click` as an
  attribute name. A remark/rehype/recma plugin runs after parsing, so it cannot
  repair any of that.
- **Positions come back through source maps**, converted after the fact, where
  `.auwla` maps every copied character exactly.
- **Async plugins.** Most of MDX's plugin ecosystem is async, while a source
  language's `toTsx` is synchronous.

What MDX gets right, and this design keeps: Markdown as the document, imports and
exports at the top level, components in the flow, `{expr}` for values.

## The design in one picture

```text
Guide.auwla.md
  │  1. pre-scan (ours): code fences, code spans, escapes, ESM blocks,
  │     Auwla elements, {expr}  ── read with JSX+'s own readers
  ▼
shadow text: the same length, Auwla regions masked
  │  2. Markdown parser (micromark → mdast, HTML and indented code disabled)
  ▼
mdast with exact offsets  +  the regions read in step 1
  │  3. emit (ours): mdast → plain JSX tags; regions spliced back as TSX pieces
  ▼
TSX module with exact mappings  ──►  compiler-next (unchanged pipeline)
```

It is the technique `.auwla` already uses (masks.ts, source.ts): read the extended
parts with our readers, hide them in a same-length shadow, let a standard parser
read the rest, and emit TSX from pieces that keep authored offsets.

### 1. Pre-scan

A small lexer walks the authored text once and finds what Markdown must never see:

| Region | How it is found | Mask |
| --- | --- | --- |
| Fenced code (```` ``` ````, `~~~`) | Line-based, as CommonMark | none: left for Markdown, and nothing inside is read |
| Code span (`` `…` ``) | Backtick runs of equal length within a block | none; nothing inside is read |
| `\{`, `\<` | Backslash escape | none |
| ESM block | A block-level line starting with `import` or `export`, read to the statement's end with host tokens | blanked |
| Block element | A tag that starts a line and whose closing tag ends one (MDX's rule): `<Callout kind="tip">` … `</Callout>` | one marker on its first line, the rest blanked |
| Inline element | Any other tag: `<Badge>"new"</Badge>`, `<Icon name="check" />` | same-length marker run, line breaks included |
| Interpolation | `{` outside code, matched with host tokens (`readSubstitution`) | same-length marker run |

The opening tag is read by JSX+'s `readOpeningTag`, so every Auwla attribute form
works unchanged. The marker is a private-use character, plain text to Markdown.
Inline masks also cover line breaks, so an element written across lines cannot
end a paragraph.

**Children of an element are Markdown again.** A block element's body is parsed
by the same pipeline from its own offset, so a callout holds paragraphs, lists and
nested components. An inline element's body is parsed as inline Markdown.

### 2. Markdown parser

Use `mdast-util-from-markdown` (micromark) with the GFM extensions: CommonMark and
GitHub behaviour (tables, task lists, strikethrough, footnotes, autolinks). Every
node carries exact start and end offsets. Two constructs are disabled, as MDX does:

- **HTML** (`htmlFlow`, `htmlText`): in a document, `<tag>` is always an Auwla
  element, never raw HTML.
- **Indented code**: content indented inside a component must not turn into code.

It is pure JavaScript, synchronous, and brings no JavaScript parser of its own. It
loads lazily at the first document, like JSX+ itself.

Writing our own Markdown parser was considered and rejected: CommonMark's emphasis
and list rules are where hand-written parsers go wrong, and authors expect GitHub's
behaviour.

### 3. Emit

The emitter walks mdast and writes TSX pieces (`source.ts`):

- **Markdown nodes become plain tags**: `<h2 id="install">`, `<p>`, `<ul>`, `<a href>`,
  `<table>`, `<pre><code class="language-ts">`. No `_components` indirection, so
  compiler-next sees static elements and clones them from templates.
- **Text becomes JSX text**, not `{"…"}` strings, with `{ } < > &` escaped as
  entities. JSX text is folded into the template; string children are written at
  run time (see compiler-next below).
- **Regions are spliced back**: an element as the TSX JSX+ normalizes it to, an
  interpolation as `{expr}`, an ESM block copied at module level.
- **The module shape:**

  ```tsx
  import { Counter } from "./Counter.auwla";          // ESM blocks, in place
  export const meta = { title: "Guide" };

  export const headings = [{ depth: 2, id: "install", text: "Install" }];  // generated
  export default function Guide() {                    // named after the file
    return <><h1 id="guide">Guide</h1><p>Click: <Counter label="Clicks" /></p></>;
  }
  ```

  `headings` lets a docs site build its sidebar and on-page contents. Heading ids
  are slugged at compile time, so anchors are static.

Copied characters keep their authored offsets, so diagnostics and the language
service map back exactly, as in `.auwla`.

## Semantics

- **A document is a component with no props and no state of its own.** Its
  Markdown is static; reactivity comes from what it embeds: a component, or an
  `{expr}` reading module state (`export let count = 0` in an ESM block is module
  state, shared like any module's).
- **Per-instance state lives in components.** Interactive parts are `.auwla`
  components; pages compose them. This keeps the page static and puts behaviour
  where Auwla's component rules already apply.
- **`{expr}` follows G-INTERP.** Prose works like quoted text without the quotes:
  `{expr}` inserts a value and `\{` writes a brace. Code spans and code fences never
  interpolate, so docs that show Auwla code write it in backticks.
- **Layouts are composition.** A route renders `<DocsLayout><Guide /></DocsLayout>`;
  there is no magic wrapper and no run-time `components` prop. Replacing what
  Markdown elements render as (a custom `<CodeBlock>` for fences) is a compile-time
  mapping, decided later, so it stays static.
- **Metadata is code.** `export const meta = { … }` is checked by TypeScript and needs
  no YAML parser. YAML front matter can be added later if wanted.

## Where it lives

- **`packages/jsx-plus/src/documents/`**: the pre-scan, the emitter and the language.
  It reuses JSX+'s readers, masks, pieces, diagnostics and checking projection, so a
  separate package would duplicate them (DX-31 keeps syntax in this package).
- **compiler-next:** one more built-in language next to `.auwla` (`built-in.ts`,
  DX-52), so no tool needs an option. Collection, imports, routing, bundling, hot
  replacement and delivery are unchanged.
- **Editor:** the content mapper already serves `normalizeForChecking`'s TSX for
  `.auwla`; documents give it the same shape, so completion, hover, rename and
  errors work inside `{expr}` and on component attributes. Highlighting injects
  Auwla's grammar into the editor's Markdown grammar.

## A compiler-next change this needs, and `.auwla` needs now

Static text is only static if it reaches the template. Measured 2026-11-16:

| Source | Template | Text written at run time |
| --- | --- | --- |
| `<p>Hello <b>world</b>.</p>` (JSX text) | `["p", 0, "Hello ", ["b", 0, "world"], "."]` | 0 |
| `<p>{"Hello "}<b>{"world"}</b>{"."}</p>` | `["p", 0, "", ["b", 0, ""], ""]` | 3 |
| `.auwla`: `<p>"Hello " <b>"world"</b> "."</p>` | same as above | 3 |

`.auwla` quoted text normalizes to string children, so every static sentence in an
`.auwla` page is written by code at mount time. Folding a constant string child into
the template, as JSX text already is, fixes that for `.auwla` today. The document
emitter avoids it by emitting JSX text, but the fold is the right fix and the first
slice.

## Slices

| Slice | Outcome | Needs |
| --- | --- | --- |
| 0 | compiler-next folds constant string children into templates; `.auwla` static text ships in templates | nothing |
| 1 | Spec: `spec/documents.md`, grammar, diagnostics (proposed `JPD1xxx`), fixtures | the decisions below |
| 2 | Pre-scan + Markdown + emit for prose, headings, lists, links, tables, code; static output and exact mappings | approval of the micromark dependencies |
| 3 | ESM blocks, block and inline elements with Markdown children, `{expr}` | slice 2 |
| 4 | Built-in language in compiler-next; Vite and Bun pick it up with no option; hot replacement | slice 3 |
| 5 | `headings` and `meta`; code-fence highlighting at build time (Shiki's synchronous highlighter, with Auwla's own TextMate grammar) | approval of Shiki |
| 6 | Editor: mapper projection, highlighting | slice 3 |
| 7 | The docs site, written in documents | slices 4–6 |

Acceptance for slices 2–4: imports in both directions; two instances of a page are
independent; a reactive prop and an event through an embedded component; a page
with no component ships as HTML with no script; errors at authored positions; a
Vite build and dev server with hot replacement.

## Decisions for the user

1. **Extension.** Recommended: `.auwla.md`. It is Markdown, so GitHub and any
   Markdown preview render it readably, and the compound suffix opts in, never
   claiming plain `.md`. Alternatives: `.mdx` (familiar, but promises MDX semantics
   and MDX tooling would misread it), plain `.md` as VitePress does (every README
   would get Auwla's editor support), or a new short extension.
2. **Dependencies.** `mdast-util-from-markdown`, `micromark-extension-gfm` and
   `mdast-util-gfm` (and what they bring) for slice 2; Shiki later for slice 5.
3. **Prose braces.** Recommended: `{expr}` interpolates and `\{` escapes, as in
   quoted text. The alternative is VitePress's `{{ expr }}`, which needs fewer escapes
   but is a second interpolation syntax.
4. **Metadata.** Recommended: `export const meta`. Alternative: YAML front matter
   (another dependency).
