# Incomplete-code checking

State: checking-only recovery built for ordinary host syntax and selected
unfinished markup, attributes and control-flow headers. Production
`normalize()`/`compile()` remain strict. All three requested steps (recovery,
handler imports and direct markup loops) are built; this extends the first step.

`normalizeForChecking()` shares the syntax reader but lets native TypeScript
recover ordinary incomplete JavaScript/TypeScript. No older source revision is
used. Failed compiler inspection simply leaves the original native checking view.

Reader errors carry checking-only repair suggestions (`Repair` in
`src/diagnostics.ts`, helpers in `src/repairs.ts`). They identify a missing
closer, an unclosed element's opening tag or a stray closing tag. Recovery in
`src/checking/recovery/markup.ts` tries those suggestions before whole-line and
error-to-line-end quarantine. It rereads the current file to validate each guess.
It searches breadth first, preferring fewer edits within a budget of three edits
and 24 rereads per projection. There is no unbounded scan over repair combinations.

An edit either inserts a closer or blanks a range while preserving its UTF-16
width and line endings. `Patch` keeps edits in authored coordinates, translates
subsequent errors and suggestions back from patched coordinates, and removes
inserted or quarantined text from copied mappings. Authored characters before
and after an insertion remain exactly mapped. For example,
`aria-label=("Remove " + task.ti` can receive a checking-only `)` while completion
still edits the authored `ti`. No repair is applied to the file on disk.

When all modified text is inside markup that read again completely
(`onlyMarkupPatched`, using recovered roots mapped back to authored ranges), any
remaining host syntax error is left for native TypeScript recovery. Otherwise,
the remaining module must parse without host errors. This prevents quarantine
from removing `const other = (` on one line and falsely treating its surviving
`1);` as an independent authored error. A same-line declaration such as
`const banner = <p>"oops` now survives when a closing quote repairs its child.

The original error remains visible. Later errors are retained when repaired at
their own location; a consequence such as a good `</main>` after a half-typed
`</fo` is not reported again when removing another tag resolves it. If no safe
candidate succeeds within the budget, the empty-module fallback keeps the
original diagnostic and makes no claim that the rest of the file was checked.

Until 2026-11-11 every remaining host error rejected the recovery, so damaged
markup plus an unrelated host typo anywhere hid every diagnostic in the file.
`tests/recovery.test.ts` covers the host error before and after the markup, and
the guard case. The real-server test shows JSX+ 1008 and TypeScript 1005
together, with member completion still available.

The host fragment reader locates unterminated literals before parser recovery
misreads later tags. The attribute reader stops at a missing-parenthesis
diagnostic instead of wandering into later elements. Spec revision 6 adds precise
locations for unfinished control-flow headers, closing tags, empty attribute
values and attribute braces; see the [changelog](spec/CHANGELOG.md). Closing-tag
scanning retains combining-mark and astral Unicode names. These are diagnostic
changes for already invalid inputs; accepted syntax and build meaning are unchanged.

`tests/recovery.test.ts` edits the actual task board and checks copied spans,
unmapped repairs, multiple insertions through UTF-16/CRLF text, safe fallback and
strict build rejection. It includes missing closing tags, half-typed elements,
an unclosed attribute brace/header and an empty attribute value.
`tests/editor-recovery-lsp.test.ts` uses the real TypeScript server for unfinished
quotes, attribute parentheses/braces, host parentheses, closing tags and a direct
loop header. Member completion works both elsewhere and inside the unfinished
attribute itself. Applying completion removes that member error while the syntax
error stays. Restoring current source clears diagnostics.

LSP may omit `textEdit` for ordinary current-word insertion. That test applies
the native edit when provided, otherwise the standard client-side label/insertText
default. It does not describe a client default as a server-provided edit.

Recovery is intentionally bounded and heuristic. The fixtures cover selected
multiline damage, not every combination. Completions inside quarantined text,
more complex missing delimiters and edits exceeding the budget remain open. No
production execution, whole-file conformance or general IDE acceptance is inferred
from this checking projection.
