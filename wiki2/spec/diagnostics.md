# Syntax diagnostics

0.1-draft, revision 4. Codes below are **proposed for the extension**; they have
not been added to compiler-next's current `CompileError` API.

## Format and locations (D-FORMAT)

The conformance representation is:

```ts
type Diagnostic = {
  code: string;
  severity: "error";
  range: [number, number];
  message: string;
};
```

Ranges are authored UTF-16 `[start, end)` offsets, as in [ast.md](ast.md). Human
display uses one-based line and column; CRLF is one line break. End-of-input may
use a zero-width range `[source.length, source.length]` where appropriate.
Messages should explain the problem and a local repair. Wording is not pinned
by conformance fixtures; codes/severity/ranges are.

An implementation maps these through the existing diagnostic path. It does not
replace all existing compiler diagnostics with new codes. Host parse/type errors
retain their host diagnostics and are mapped back to authored locations.

## Core draft codes (D-CODES)

| Code | Condition | Primary range |
| --- | --- | --- |
| JPX1001 | Closing element name does not match the opener | The closing tag, including delimiters |
| JPX1002 | Element/fragment has no closing delimiter at end of input | Its opening tag/fragment |
| JPX1003 | String/template child or parenthesized attribute token is unterminated | Opening quote/backtick, one UTF-16 unit |
| JPX1004 | Expression has begun but is incomplete at its body end | The body-end delimiter, or EOF |
| JPX1005 | Missing separator between same-line non-joining expressions or before an ambiguous sibling opening tag | First token of the intended next child |
| JPX1006 | Direct `if`/`else` body is not a block | First token where the required `{` was expected |
| JPX1007 | Conditional child block is unclosed at EOF | The opening `{` |
| JPX1008 | Parenthesized attribute expression has no matching outer `)` | The opening `(` |
| JPX1009 | Undelimited attribute value is not a single host identifier | The undelimited value, up to attribute whitespace or `>`/`/>` |

Do not infer duplicate-attribute, unknown-tag, unknown-method or key restrictions
from this table. Existing JSX/host rules and agreed framework contracts decide
those. Bare `message` is an identifier, including when it reads a host global.
Any missing-name error follows ordinary host/tooling behavior; it is not literal
text or a JSX+ unknown-text error. Valid JavaScript is not rejected merely because
a name or method is unknown to the compiler.

For JPX1005, a tag token means its opening-tag span, and a host token means that
token's span. If code has more than one plausible intention, the diagnostic should
state the candidate repair rather than change a comparison into sibling markup.
A top-level comma operator used as a child (`<p>a, b</p>`) is also JPX1005, with
the first top-level comma as its range: the author may have meant a `;`, quoted
text or a parenthesized comma expression, and the message names those repairs.

JPX1009 applies only to an undelimited value: one that does not begin with a
quote, `{`, `(` or `<`. Examples are `onClick=handlers.add`, `value=true` and
`onClick=addTask()`. The message names `(...)` or `{...}` as the repair. Plain
JSX has no valid undelimited value, so no existing JSX program is affected.

## Recovery and error precedence (D-RECOVERY)

At a token boundary a complete mismatched closing tag takes JPX1001 over a generic
host-expression error. EOF with an open token reports the unterminated token
before an unclosed surrounding element/block. Otherwise the earliest decisive
syntax error is primary. More recovery diagnostics may follow, in source order.

An editor MAY retain a partial syntax tree and incomplete ranges to offer useful
tooling after an error. A build MUST NOT silently treat that partial tree as a
successful executable parse. Recovery must respect string/comment/template/regex
boundaries rather than finding the next `>` textually.

Stable codes are not renumbered/reused. A changed condition or range expectation
is a spec revision recorded with its fixture changes. Integration may choose an
existing code if it already expresses the exact condition; record that mapping
before reporting diagnostic conformance.
