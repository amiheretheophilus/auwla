# CSS-4: source-aware named-style editor assistance

Working contract, created 2026-11-14; implemented 2026-11-15. Builds keep [CSS-3b](style-reuse.md)'s existing
compiler-owned resolution and delivery. This slice adds editor source lookup,
not a JSX+ build project or a second style validator.

## Source host and lifetime

The shared tooling accepts an injected host for reading source text and listing
one directory. Optional resolution supports editor-specific aliases. Shared
`src/` uses no filesystem/editor SDK, Bun or Node API. Default lookup is relative
to a document URI; unresolved aliases without a configured resolver are deferred,
not reported as missing physical files. Alias path discovery is later work.
Untitled/opaque document URIs without a directory retain the single-file profile
until saved. The VS Code adapter does not yet wire project alias configuration.

VS Code supplies workspace filesystem access and prefers open unsaved documents.
Each open consumer keeps one current source snapshot. Reads follow only `@use`
dependencies, never JS imports or execution. Cache invalidation records read and
missing targets, so source edits, unsaved edits, creation, deletion and close
refresh affected consumers. Closed consumers release their snapshots. Stale async
work must not publish diagnostics or completions after an edit/close/disposal.

## Completion and diagnostics

Inside the first quoted argument of `@use`, suggest relative directories and
`.auwla` files from the selected directory, including the current source file.
Inside the second quoted argument, suggest the selected source's named style IDs.
Recognize incomplete calls/strings and CSS escapes through shared CSS tokens.
Strings/comments/functions that merely contain `@use` are not directives.
Completion edits replace only the original argument contents, preserve its quote
style and escape inserted CSS strings. Never edit outside a style body.

Reuse `styleChunks` for duplicate/missing IDs, missing sources and transitive
cycles. Direct errors retain authored consumer ranges. Transitive errors appear
at the consumer use with related information naming the original dependency URI
and UTF-16 range. Reader failures become use diagnostics rather than unhandled
provider failures. Editing an external source refreshes consumers even if their
own document versions did not change. Native CSS assistance remains independent
of TypeScript. Hosts without source lookup retain the current single-file profile.

The existing validator carries the originating consumer use while expanding named
definitions. An error in one selected definition must not be attached to an
unrelated use of another definition in the same source file. Authored diagnostics
keep their original ranges, including local style headers outside CSS bodies;
only recovered native CSS diagnostics need boundary clamping.

Tests use in-memory hosts and independent fixture apps, never examples. Cover
applied edits, Unicode/CRLF, CSS escapes, incomplete arguments, unsaved sources,
source creation/deletion, transitive errors/cycles, stale requests, close/dispose
and the built Node artifact with workspace filesystem access.
