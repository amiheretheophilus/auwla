# Diagnostics

Proposed codes for documents. Messages name the problem and the local repair; conformance
pins codes, severity and ranges, not wording (as wiki2's D-FORMAT).

| Code | Condition | Primary range |
| --- | --- | --- |
| JPD1001 | An element has no closing tag before its container ends or the file ends | Its opening tag |
| JPD1002 | A closing tag does not match the open element | The closing tag |
| JPD1003 | An ESM block holds something other than import and export declarations | That statement |
| JPD1004 | An import declaration inside an element, list, blockquote or table | The declaration |
| JPD1005 | A closing tag with no open element | The closing tag |
| JPD1006 | `<!--`: HTML comments are not available; the message names `{/* … */}` | The `<!--` |
| JPD1007 | A fragment `<>` | The `<>` |
| JPD1008 | An authored export named `headings`, which the document generates | The exported name |

## Reused from `.auwla`

Inside a tag or `{...}`, the reader is `.auwla`'s, and so are its codes: unterminated
attribute strings (`JPX1003`), unclosed `=(` (`JPX1008`), invalid bare values (`JPX1009`), and
the substitution codes `JPX1012`, `JPX1013` and `JPX1014`. Host syntax and type errors inside
expressions are the host's, mapped to their authored positions.

## Recovery

The editor checks an unfinished document as `.auwla` does: an unclosed element or value is
closed for checking only, so the rest of the document keeps its diagnostics and completion.
A build never accepts that recovered text.
