# Documents spec

Version: **0.1-draft**, revision **1**, 2026-11-16. Nothing is implemented yet.

The language rules for `.auwla.md` documents. Rules marked **provisional** wait on an
open decision ([decisions](../decisions.md)); the others follow accepted direction. A rule
changes with its fixtures, in a new revision, never in code alone.

| Page | Rules |
| --- | --- |
| [grammar.md](grammar.md) | D-DOC, D-MD, D-ESM, D-ELEM, D-EXPR, D-CODE, D-ESC |
| [semantics.md](semantics.md) | S-MODULE, S-NODES, S-TEXT, S-ELEM, S-EXPR, S-HEADINGS, S-STATIC |
| [diagnostics.md](diagnostics.md) | Codes `JPD1001`+, and which `.auwla` codes documents reuse |
| [cases.json](cases.json) | Draft fixtures: emitted TSX and diagnostics |

## Borrowed from `.auwla`

Inside a tag and inside `{...}`, documents follow wiki2's spec exactly; these pages do not
restate it:

- element names, attributes and their values: [G-ATTR](../../wiki2/spec/grammar.md#attributes-and-existing-refs-g-attr),
  including `=(expr)`, bare identifiers and interpolated strings (revision 10), and the
  class shorthand and `@` events once their specs exist (DX-53);
- substitutions: [G-INTERP](../../wiki2/spec/grammar.md#quoted-text-interpolation-g-interp)
  (host-token matching, empty and non-expression substitutions);
- the attribute and substitution diagnostics (`JPX1003`, `JPX1008`, `JPX1009`, `JPX1012`–`JPX1014`).

## Ranges

As in wiki2: authored UTF-16 `[start, end)` offsets; CRLF is one line break in display.
