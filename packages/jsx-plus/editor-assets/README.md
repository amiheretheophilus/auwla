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
The transformation adds quoted-child interpolation, direct child control blocks,
parenthesized attributes and bare identifier values to the TSX rules. Embedded
substitutions have a code scope, so string-only completion settings do not suppress
their suggestions. Other strings, comments, templates and nested tags retain the
TSX lexical rules. Tests check the actual tokenizer's encoded token attributes
as well as scopes. Other
TextMate adapters can consume the same generated grammar without VS Code or a
separately registered TSX grammar. Other highlighting engines need their own assets.

CSS blocks embed `source.css`. VS Code supplies that grammar natively; other
TextMate hosts must register it too. `vendor/css.tmLanguage.json` is the unchanged
CSS grammar distributed with Microsoft VS Code 1.126.0, identifying upstream
`microsoft/vscode-css` commit `9a07d76cb0e7a56f9bfc76328a57227751e4adb4`.
`vendor/CSS-LICENSE.txt` retains its MIT and upstream TextMate notices. The real
tokenizer tests load this copy, including delimiter-like text in CSS strings and
comments, and verify return to TypeScript after the block.

`@memoized-dom/jsx-plus/styles` exports `createCssSession` for completion, hover
and validation over an equal-width authored CSS projection. This service has no
editor SDK or production build dependency. Adapters translate its protocol
objects and manage document lifetime. It is independent of TypeScript's mapper.

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
