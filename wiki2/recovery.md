# Incomplete-code checking

State: checking-only recovery built for ordinary host syntax and isolated markup
lines. Production `normalize()`/`compile()` remain strict. This is the first of
the user's three requested steps; handler imports and direct markup loops follow.

`normalizeForChecking()` shares the syntax reader but lets native TypeScript
recover ordinary incomplete JavaScript/TypeScript. No older source revision is
used. Failed compiler inspection simply leaves the original native checking view.

Markup failures use `src/checking/recovery/markup.ts`: blank the damaged line,
preserving UTF-16 width and all line endings, and retry the current file. At most
three lines may be quarantined. When every quarantined character was blank or
inside markup that read again completely (`onlyMarkupQuarantined`, checked
against the recovered roots' authored ranges), the quarantine changed only that
markup. Any host syntax error that remains is then the author's own, left mapped
for native TypeScript recovery as in an undamaged file. Otherwise, for example
when the blanked line also held `const banner =`, the remaining module must
parse with no host error. Every quarantined character is excluded from copied
maps, and the authored syntax diagnostic remains visible. All other mapped
characters must equal their current authored spelling. Unrecoverable structural
damage retains the existing empty-module fallback with the original error.

Until 2026-11-11 every remaining host error rejected the recovery, so damaged
markup plus an unrelated host typo anywhere hid every diagnostic in the file.
`tests/recovery.test.ts` covers the host error before and after the markup, and
the guard case. The real-server test shows JSX+ 1008 and TypeScript 1005
together, with member completion still available.

The host fragment reader now locates unterminated literals before parser recovery
misreads later tags. The attribute reader likewise stops at a missing-parenthesis
diagnostic instead of wandering into later elements. This repairs original
diagnostic locations; it does not synthesize closing tokens or change build syntax.

`tests/recovery.test.ts` edits the actual task board and checks copied spans,
unmapped holes and strict build rejection. `tests/editor-recovery-lsp.test.ts`
uses the real TypeScript server for unfinished quotes, attribute parentheses
and ordinary host parentheses. A separate member error and completion remain
available; applying completion removes that member error while the syntax error
stays. Restoring current source clears diagnostics.

LSP may omit `textEdit` for ordinary current-word insertion. That test applies
the native edit when provided, otherwise the standard client-side label/insertText
default. It does not describe a client default as a server-provided edit.

Recovery is intentionally bounded. Multiline structural damage and completions
inside quarantined text need additional work. No production execution, whole-file
conformance or general IDE acceptance is inferred from this checking projection.
