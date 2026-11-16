# Semantics

## The module (S-MODULE)

A document compiles to one TSX module:

```tsx
import { Counter } from "./Counter.auwla";      // ESM blocks, in their order
export const meta = { title: "Guide" };

export const headings = [{ depth: 1, id: "guide", text: "Guide" }];   // generated
export default function Guide() {
  return <><h1 id="guide">Guide</h1><p>Clicks: <Counter label="Clicks" /></p></>;
}
```

- **ESM blocks** are copied to module scope in their authored order, ahead of the component.
  Their bindings are in scope for every `{expr}` and attribute in the document. A top-level
  `let` is module state, shared by every place the document is shown, as in any module.
- **The default export** is a component with no parameters, named after the file:
  `getting-started.auwla.md` → `GettingStarted`. The name is the file name before `.auwla.md`,
  split on `-`, `_`, `.` and spaces, each part capitalized. A name that would not start
  with a letter gets a `Document` prefix (`01-intro` → `Document01Intro`).
- **`headings`** is generated (S-HEADINGS). An authored export named `headings` is `JPD1008`.
- **`meta`** is authored, not generated. **Provisional** (decision 3).
- A document's default export may be imported by `.auwla`, `.tsx` or another document, and
  used like any component: `<Guide />`.

## Markdown nodes (S-NODES)

| Markdown | Element |
| --- | --- |
| Heading, depth *n* | `<hn id="…">` (S-HEADINGS) |
| Paragraph | `<p>` |
| Emphasis / strong / strikethrough | `<em>` / `<strong>` / `<del>` |
| Code span | `<code>` |
| Fenced code with info `lang …` | `<pre><code class="language-lang">` (no class without info) |
| Link `[text](url "title")` | `<a href="url" title="title">` |
| Image `![alt](src "title")` | `<img src="src" alt="alt" title="title">` |
| Bullet / ordered list | `<ul>` / `<ol>`, with `start` when it is not 1 |
| List item, task item | `<li>`; a task item starts with `<input type="checkbox" disabled>`, `checked` when done |
| Blockquote | `<blockquote>` |
| Thematic break | `<hr>` |
| Hard line break | `<br>` |
| Table | `<table><thead><tr><th>…</th></tr></thead><tbody>…</tbody></table>`, alignment as `style="text-align: …"` |
| Footnotes | GitHub's markup: references `<sup><a href="#fn-x">`, a closing `<section class="footnotes">` |

Link reference definitions produce nothing themselves. Attribute values from Markdown (`href`,
`src`, `alt`, `title`) are static strings.

## Text (S-TEXT)

Markdown text is static: it is emitted as JSX text, part of the element's template. A soft
line break is a line feed in the text, which HTML shows as a space. Character references
(`&amp;`) mean what CommonMark says. An inline value or element in a paragraph splits the
text around it; the text stays static.

## Elements (S-ELEM)

An element is an `.auwla` element: an intrinsic element or a component, with `.auwla`'s
attribute meaning and timing. Its children (D-ELEM) are passed as `children`, exactly as
markup children are in `.auwla`. A document never wraps a component's children in an extra
element of its own, except the paragraphs Markdown itself makes in block children.

## Values (S-EXPR)

`{expr}` is an expression child at that place, with compiler-next's ordinary meaning: it
updates when what it reads changes (module state, a store). A block value (D-EXPR) is a child
of the document's fragment or of its element. A comment produces nothing.

## Headings (S-HEADINGS)

Every heading gets an `id`, the slug of its text content: lower-cased, characters other than
letters, digits, spaces and `-` removed, spaces turned into `-`. A repeated slug gets `-1`,
`-2`, … in document order. A heading's text is its static text; an interpolation inside a
heading contributes nothing to the slug, so slugs never change at run time.

`headings` lists every heading in document order: `{ depth, id, text }`, with `text` the same
static text the slug was made from.

## Static by default (S-STATIC)

A document holds no state and takes no props, so its own markup is static: Markdown compiles
to cloned templates with no update code. Only embedded components and values that read
changing state produce update code. A document with neither ships as HTML where compiler-next
delivers static pages.
