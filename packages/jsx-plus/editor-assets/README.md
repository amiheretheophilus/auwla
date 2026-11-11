# Shared editor assets

This directory belongs to the language tooling, independently of any editor
adapter. The editor metadata and mapper launch contribution are exported from
`@memoized-dom/jsx-plus/editor`. That export does not load an editor SDK or the
production compiler facade. `@memoized-dom/jsx-plus/editor/grammar` exports
`createAuwlaGrammar`, a build-time transformation returning a standalone TextMate
grammar. `language-configuration.json` provides comment, quote and bracket pairs.

The TSX grammar in `vendor/TypeScriptReact.tmLanguage` is unmodified from
[microsoft/TypeScript-TmLanguage](https://github.com/microsoft/TypeScript-TmLanguage/tree/eeeb0dc4daa8793b8227bb3b34ddfc267c85fd81),
commit `eeeb0dc4daa8793b8227bb3b34ddfc267c85fd81`. Its MIT license is retained.
The transformation replaces the JSX child rule with the host statement rules
and adds parenthesized and bare-identifier attribute values. String, comment,
template and nested-tag boundaries remain owned by the TSX rules. Other
TextMate adapters can consume the same generated grammar without VS Code or a
separately registered TSX grammar. Other highlighting engines need their own assets.

For another editor adapter:

1. Register `.auwla`, language id `auwla` and grammar scope `source.auwla`.
2. Parse the pinned vendor grammar, then pass it to `createAuwlaGrammar` and emit
   the returned object as JSON. The VS Code build script demonstrates this.
3. Resolve this package's directory and call `createMapperContribution` for the
   TypeScript content-mapper host. Its launch uses Bun and the package's existing
   mapper manifest; install the package's workspace dependencies first.
4. Keep host-specific registration, lifecycle and settings in your adapter.

The mapper contribution is protocol data, not an LSP server. The editor needs a
compatible TypeScript content-mapper host or a bridge. Headless tests tokenize
the real task board and launch/transform it through the contributed command.
They do not verify another desktop editor or full grammar conformance.
