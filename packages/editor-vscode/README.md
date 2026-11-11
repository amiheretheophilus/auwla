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

For a local VSIX installation, package the build with the standard VS Code
packager using `--no-dependencies`, then install the resulting file with
`code --install-extension <file.vsix>`. `.vscodeignore` keeps source, tests and
workspace dependencies out of the archive. The activation bundle includes its
small registration helper; the mapper process remains in the project.

The installed adapter resolves `@memoized-dom/jsx-plus` from open workspace folders,
then falls back to the adapter directory for development hosts. The content mapper
still launches with Bun from that shared package, which must remain installed
with its workspace dependencies. This local VSIX is not a self-contained mapper
or a published cross-runtime distribution. Open this checkout or its task-board
example as the workspace when trying the installed prototype.
Configured projects keep their `contentMappers`/type settings; the task-board
tsconfig is the authoring example. Registration also supplies an inferred-project
manifest, but complete standalone JSX type setup remains unverified.

Activation tests simulate only the editor API and TypeScript provider. Shared
tests use the real TextMate engine, Oniguruma and mapper process. Desktop activation
and TypeScript extension integration remain separate
acceptance checks; do not infer them from the simulated tests. Formatting,
tree-sitter assets and another editor adapter remain planned.
