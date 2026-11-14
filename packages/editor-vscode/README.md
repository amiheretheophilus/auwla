# Auwla VS Code adapter (prototype)

This separate package registers `.auwla` and consumes the shared language tooling
in `packages/jsx-plus`. It contains no parser, checking rules or recovery logic.
Highlighting and editor configuration are built from the shared assets; other
extensions can reuse them without installing this adapter. See
[shared assets](../jsx-plus/editor-assets/README.md).

From this package:

Version 0.0.11 includes numeric viewport-condition highlighting and native value
assistance (`@700` equals `@700px`). The built artifact is probed with the real
responsive named-style source under Node outside the checkout. Reload VS Code
after installing the updated VSIX.

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

## Reactivity hints

Beside each declaration, like an inferred type, the adapter shows what the
compiler decided the binding is: `: state`, `: derived ← count, filter` (with the
values it follows), `: state ← start` (writable, following a value until written),
or `: source`. A value that loads data and re-runs when its inputs change, such as
`getPeople(search)`, is `: derived ← search`. Hover the declared name for what it
means. Turn them off with **Auwla › Reactivity Hints** (`auwla.reactivityHints`).
They need no TypeScript extension. The shared core
(`@memoized-dom/jsx-plus/editor/hints`) decides them from compiler-next's
analysis; this adapter only shows them.

They are editor decorations rather than inlay hints, because VS Code draws every
inlay hint in one theme color, which reads like a comment. The hints use their own
colors, `auwla.reactivityHint.foreground` (amber by default) and
`auwla.reactivityHint.background`; change them under
`workbench.colorCustomizations`.

TypeScript's own type hints (`count: number`) also work in `.auwla` once the
mapper is registered (`typescript.inlayHints.variableTypes.enabled`). TypeScript
7.1-beta repeats a function's return-type hint once per mapped segment of the
file, so prefer variable-type hints until that is fixed upstream.

Version 0.0.10 extends the shared CSS parser for implicit nesting in local/named
blocks. Valid cross-file `@use` syntax remains usable without false missing-file
errors; external ID/path discovery and dependency diagnostics require a source
host and remain separate work. The installed bundle is probed on the real gallery.

Version 0.0.9 adds CSS-3a assistance/highlighting for local module, component and
named style blocks, including same-file `@use(path, id)` syntax/ID diagnostics.
The bundled artifact is tested on `examples/scoping/Cards.auwla` outside the
workspace under Node. After reinstalling, reload the VS Code window to use it.
That version predates cross-file source linking; desktop acceptance remains separate.

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

Version 0.0.5 adds CSS-2a class-condition header highlighting and native property
value completion inside clauses such as `color:black @.loading:red`. The installed
artifact probe exercises that completion alongside ordinary CSS recovery. Class
name discovery, grouped conditions and named breakpoints are not implemented yet.

Version 0.0.6 adds reactivity hints (above): `state`, `derived ← inputs` or
`source` beside each declaration. The installed artifact probe runs them in Node,
with compiler-next's analysis bundled.

Version 0.0.7 shows them as `: label` in their own colors (decorations), after the
user found the inlay-hint color unreadable beside comments. The setting is now
`auwla.reactivityHints`.

Version 0.0.8 explains each hint with the file's own code: where the value is
written, what runs again and what reads it. A value the component body assigns
(`if (count > 10) message = "yeah"`) is derived from what those statements read,
and a local nothing changes gets no hint.

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
