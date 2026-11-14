# Syntax diagnostics

0.1-draft, revision 7. Codes below are **proposed for the extension**; they have
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
| JPX1001 | Closing element name does not match the opener, or the closing tag is incomplete (no `>` after its name) | The closing tag, including delimiters; for an incomplete one, `</` through its name |
| JPX1002 | Element/fragment has no closing delimiter at end of input | Its opening tag/fragment |
| JPX1003 | String/template child or parenthesized attribute token is unterminated | Opening quote/backtick, one UTF-16 unit |
| JPX1004 | Expression has begun but is incomplete at its body end | The body-end delimiter, or EOF |
| JPX1005 | Missing separator between same-line non-joining expressions or before an ambiguous sibling opening tag | First token of the intended next child |
| JPX1006 | Direct `if`/`else` or `for` body is not a block | First token where the required `{` was expected |
| JPX1007 | Conditional child block is unclosed at EOF | The opening `{` |
| JPX1008 | Parenthesized attribute expression has no matching outer `)` | The opening `(` |
| JPX1009 | Undelimited attribute value is not a single host identifier, or the value is missing before `>` | The undelimited value, up to attribute whitespace or `>`/`/>`; for a missing value, the `>` |
| JPX1010 | Child loop is not `for (const binding of iterable)`: `let`/`var`, no declaration, `for...in`, C-style or `for await` | The `for` keyword |
| JPX1011 | A child-level `if`/`for` header `(` has no matching `)` before the body end | The opening `(` |
| JPX1012 | Quoted text interpolation has no matching `}` | The opening `{` |
| JPX1013 | Quoted text interpolation contains no expression (including trivia-only content) | The opening `{` |

Do not infer duplicate-attribute, unknown-tag, unknown-method or key restrictions
from this table. Existing JSX/host rules and agreed framework contracts decide
those. Bare `message` is an identifier, including when it reads a host global.
Any missing-name error follows ordinary host/tooling behavior; it is not literal
text or a JSX+ unknown-text error. Valid JavaScript is not rejected merely because
a name or method is unknown to the compiler.

For JPX1005, a tag token means its opening-tag span, and a host token means that
token's span. If code has more than one plausible intention, the diagnostic should
state the candidate repair rather than change a comparison into sibling markup.
A tag written after a text or expression child without `;` is JPX1005 over its
opening tag, named as the repair (G-BOUNDARY rule 5). A self-closing tag
(`"Label" <input />`) breaks the host comparison directly. A tag with a body
(`"Retry?" <button>"Retry"</button>`) is read as `"Retry?" < button > ...`, so
the scan meets `</button>` as if it closed the enclosing element. JPX1005 takes
precedence over that JPX1001 only when the closer's name follows a `<` read as
a comparison and the text from that `<` through the closer reads as one whole
element. A fragment `<>` there is JPX1005 over `<>`. When the joined tag has the
enclosing element's name (`<p>"a" <p>"b"</p></p>`), its closer matches, so the
outer element closes there and the comparison is valid host code. Such a
comparison is only a candidate. If the file then fails anywhere after it, and the
same file with `;` before that `<` gets past the failure, the error is JPX1005
over that opening tag instead. Code that does not fail (`<b>x < b > y</b>`) is
never reported.
A top-level comma operator used as a child (`<p>a, b</p>`) is also JPX1005, with
the first top-level comma as its range: the author may have meant a `;`, quoted
text or a parenthesized comma expression, and the message names those repairs.

JPX1009 applies only to an undelimited value: one that does not begin with a
quote, `{`, `(` or `<`. Examples are `onClick=handlers.add`, `value=true` and
`onClick=addTask()`. The message names `(...)` or `{...}` as the repair. Plain
JSX has no valid undelimited value, so no existing JSX program is affected.
An empty value directly before the tag's `>` (`<input value=>`) is JPX1009 too,
ranged over that `>`; the host lexer would otherwise read `=>` as one token and
run the tag on to a later `>`.

JPX1011 takes precedence over the surrounding element's JPX1002. While the
header is open the closing tag is not at child level, so the scan reaches the
end of input, and the open token is reported first (D-RECOVERY).

A host error inside an opening tag is mapped to its authored cause where one is
known. An attribute `{` that never closes, or whose content up to a later
unrelated `}` holds no single expression, is reported at that `{` rather than
over the rest of the file. An opening tag that meets a closing tag's `</` before
its own `>` (`<section><Badg</section>`, a tag still being typed) is incomplete
there: a closing tag is never part of an opening tag, so its `>` does not end
this one. The error covers the opening tag up to that `</`, and recovery closes it
as ` />` for checking only, so native tag-name completion works.

## Recovery and error precedence (D-RECOVERY)

At a token boundary a complete mismatched closing tag takes JPX1001 over a generic
host-expression error, unless it closes a tag joined to the previous child by a
missing `;` (JPX1005, above). EOF with an open token reports the unterminated token
before an unclosed surrounding element/block. Otherwise the earliest decisive
syntax error is primary. More recovery diagnostics may follow, in source order.

Within quoted text, a missing substitution closer reports JPX1012 before a
missing outer quote. For checking only, an empty substitution may remain in the
TSX view for native syntax recovery and scope completion; strict builds retain
JPX1013. Inserted checking-only closers never become authored edit spans.

An editor MAY retain a partial syntax tree and incomplete ranges to offer useful
tooling after an error. A build MUST NOT silently treat that partial tree as a
successful executable parse. Recovery must respect string/comment/template/regex
boundaries rather than finding the next `>` textually.

Stable codes are not renumbered/reused. A changed condition or range expectation
is a spec revision recorded with its fixture changes. Integration may choose an
existing code if it already expresses the exact condition; record that mapping
before reporting diagnostic conformance.
