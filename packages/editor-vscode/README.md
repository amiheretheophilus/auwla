# Auwla VS Code adapter (prototype)

This separate package registers `.auwla` and consumes the shared language tooling
in `packages/jsx-plus`. It contains no parser, checking rules or recovery logic.
Highlighting and editor configuration are built from the shared assets; other
extensions can reuse them without installing this adapter. See
[shared assets](../jsx-plus/editor-assets/README.md).

From this package:

```text
bun run build
bun check
bun test
```

The build bundles the activation module and emits a standalone TextMate grammar
and language configuration into `dist/`. It retains the upstream grammar license.
Dependencies must be installed with `bun install` at the repository root.

To try the local adapter in a development host, run from the repository root:

```text
code --extensionDevelopmentPath=./packages/editor-vscode ./packages/jsx-plus/examples/task-board
```

Open `App.auwla`. For language features, install and enable the compatible
**TypeScript 7** extension (`TypeScriptTeam.native-preview`) in the development
host and select the workspace's TypeScript 7.1-beta SDK if needed. The adapter
checks its `registerContentMappers` API and registers the shared mapper. It does
not change editor settings or install the TypeScript extension automatically.
Without the provider, static highlighting remains available and activation
reports the missing dependency. Details appear in the Auwla output channel.

The content mapper still launches with Bun from the local shared package, which
must remain installed with its workspace dependencies. This is a local development
adapter, not a self-contained VSIX or published cross-runtime distribution.
Configured projects keep their `contentMappers`/type settings; the task-board
tsconfig is the authoring example. Registration also supplies an inferred-project
manifest, but complete standalone JSX type setup remains unverified.

Activation tests simulate only the editor API and TypeScript provider. Shared
tests use the real TextMate engine, Oniguruma and mapper process. Desktop activation,
TypeScript extension integration and the packaged installation remain separate
acceptance checks; do not infer them from the simulated tests. Formatting,
tree-sitter assets and another editor adapter remain planned.
