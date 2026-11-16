# Grammar

## Document (D-DOC)

```ebnf
Document  ::= Block*
Block     ::= EsmBlock | BlockElement | MarkdownBlock
```

A document is read in two passes ([architecture](../architecture.md#pipeline)): a pre-scan
finds the regions below, then a Markdown parser reads the rest. The regions' rules here are
what the pre-scan follows; everything else is Markdown (D-MD).

## Markdown (D-MD)

CommonMark 0.31 with GitHub Flavored Markdown: tables, task list items, strikethrough,
footnotes and literal autolinks. Two CommonMark constructs are **removed**:

- **Raw HTML** (HTML blocks and inline HTML). `<` followed by a name start is always an
  element (D-ELEM). `<!--` is an error (`JPD1006`); comments are `{/* … */}` (D-EXPR).
- **Indented code blocks.** Indentation is never code, so content indented inside an
  element or list stays content. Code is fenced (D-CODE).

Autolinks keep their CommonMark meaning when they begin with a scheme and `://`, or with
`mailto:`: `<https://example.com>`. Any other `<name` starts an element. **Provisional:**
CommonMark accepts `<scheme:…>` for any scheme, which would make namespaced elements such as
`<svg:rect>` links.

## Module code (D-ESM)

```ebnf
EsmBlock ::= ("import" | "export") HostText  (* to the first blank line or the end *)
```

- An ESM block starts at a line beginning with `import` or `export` (column 0, followed by a
  space, `{` or `*`) at the **top level** of the document: not inside an element, list,
  blockquote or table. Elsewhere such a line is ordinary text.
- It runs to the first blank line or the end of the file and must parse as TypeScript
  import and export declarations only (`export const`, `export let`, `export function`,
  `export type`, `import type` …). Anything else is `JPD1003`, ranged over the statement.
- A line starting with `import` inside an element is `JPD1004` only when it parses as an
  import declaration; otherwise it is text.

## Elements (D-ELEM)

```ebnf
BlockElement  ::= OpeningTag LineEnd MarkdownBlock* ClosingTag LineEnd
                | OpeningTag ...inline children... ClosingTag LineEnd   (* on one line *)
                | SelfClosingTag LineEnd
InlineElement ::= OpeningTag InlineContent ClosingTag | SelfClosingTag
```

- The opening tag is read by `.auwla`'s opening-tag reader: names, attributes and values are
  G-ATTR's ([spec README](README.md#borrowed-from-auwla)).
- **Block or inline (MDX's rule).** An element is a block when its opening tag is the first
  non-blank text of its line (indented at most 3 spaces more than its container) and its
  closing tag, or self-closing `/>`, is the last non-blank text of a line. Otherwise it is
  inline, inside the surrounding paragraph.
- **Children.** A block element whose children start on a later line than the opening tag
  holds Markdown blocks (paragraphs, lists, nested elements). A block element written on one
  line, and every inline element, holds inline Markdown: no paragraph is made around it.
- The closing tag is found by name at the same nesting, outside code (D-CODE) and outside
  `{...}`; a missing one is `JPD1001`, a different name `JPD1002`.
- Fragments (`<>`) are not elements in documents: `JPD1007`. Markdown already groups content.
- An element's body is never read as `.auwla` child grammar: inside an element, text is
  Markdown, not quoted strings.

## Values (D-EXPR)

```ebnf
Interpolation ::= "{" HostExpression "}"
Comment       ::= "{" HostTrivia "}"       (* only comments and whitespace *)
```

- `{` in inline content, outside code (D-CODE) and not escaped (D-ESC), opens a substitution.
  The matching `}` is found with host tokens, as G-INTERP; the expression is TypeScript.
- A paragraph whose only content is one interpolation is a **block value**: no `<p>` is made
  around it (MDX's rule).
- `{}` with only comments or whitespace inside is a comment and produces nothing. An empty
  `{}` is `JPX1013` as in `.auwla`. **Provisional** (decision 4): the comment form.
- **Provisional** (decision 2): `{expr}` is the interpolation syntax in prose.

## Code (D-CODE)

Fenced code blocks (```` ``` ```` or `~~~`, CommonMark's rules) and code spans (backtick runs)
are literal. Nothing inside them is an element, a value or an escape.

## Escapes (D-ESC)

CommonMark's backslash escapes apply. In particular `\{`, `\}` and `\<` are literal
characters, so prose about Auwla can write braces and tags without starting one.
