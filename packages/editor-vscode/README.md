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
logs the actual selected server version and warns when it is older than 7.1;
having the extension installed does not mean its bundled server supports mappers.
Use **Ctrl+Shift+P** (the Command Palette, with a leading `>`), then
**TypeScript: Select TypeScript Version... → Use Workspace Version**. The native
command is `typescript.native-preview.selectVersion`; the warning's **Select
Workspace SDK** action opens that picker directly. This checkout's
`.vscode/settings.json` points to its pinned SDK, but the TypeScript extension
still requires choosing the workspace version.

The adapter
checks its `registerContentMappers` API and registers the shared mapper. It does
not change editor settings or install the TypeScript extension automatically.
Without the provider, static highlighting remains available and activation
reports the missing dependency. Details appear in the Auwla output channel.

For a local VSIX installation, package the build with the standard VS Code
packager using `--no-dependencies`, then install the resulting file with
`code --install-extension <file.vsix>`. `.vscodeignore` keeps source, tests and
workspace dependencies out of the archive. The activation bundle includes its
small registration helper; the mapper process remains in the project.

Version 0.0.3 adds CSS completion, hover and live diagnostics for module-level
`<style global>` blocks. `src/css.ts` only adapts the shared CSS service; it
registers even when the TypeScript provider is unavailable. The grammar embeds
VS Code's native CSS grammar. Build and reinstall the updated adapter, then
reload the window to use these changes. The source build alone does not update
an installed extension. CSS diagnostics and edits are checked through simulated
adapter calls; desktop acceptance of this version is still separate.

The build resolves the CSS service's supplied ESM entry. Its UMD entry hides
dynamic child imports from Bun's bundler and produced an incomplete activation
bundle. `tests/bundle.test.ts` now builds, copies the artifact outside the
workspace and loads it in Node with only the VS Code API supplied, checking CSS
completion, hover and diagnostics. The same probe passes against the installed
0.0.3 VSIX. Native parser bindings still come from this build checkout; portable
parser packaging remains open. VS Code must reload its window after installation.

Version 0.0.4 corrects CSS diagnostic recovery while typing a property such as
`cur` immediately before `}`. The missing-colon error points to `cur`; valid
following rules no longer receive errors from that declaration. The installed
bundle test covers the declaration's range and checks for downstream errors.

The installed adapter resolves `@memoized-dom/jsx-plus` from open workspace folders,
then falls back to the adapter directory for development hosts. The content mapper
still launches with Bun from that shared package, which must remain installed
with its workspace dependencies. This local VSIX is not a self-contained mapper
or a published cross-runtime distribution. Open this checkout or its task-board
example as the workspace when trying the installed prototype.
Configured projects keep their `contentMappers`/type settings; the task-board
tsconfig is the authoring example. The counter's examples config enables the
shared `@memoized-dom/jsx-plus/types` entry once, without a per-file type import,
and sets `jsx: "preserve"`. Registration also supplies an inferred-project
manifest, but complete standalone JSX type setup remains unverified.

Activation tests simulate only the editor API and TypeScript provider. Shared
tests use the real TextMate engine, Oniguruma and mapper process. Desktop activation
and TypeScript extension integration remain separate
acceptance checks; do not infer them from the simulated tests. Formatting,
tree-sitter assets and another editor adapter remain planned.
