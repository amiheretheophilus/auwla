# TypeScript and editor tooling

State: TypeScript 7.1-beta mapper/CLI/LSP probe and first paired flow-checking
profile built. Broader editor/flow acceptance remains open. Owns DX-01, DX-03,
DX-24 and tooling DX-26.

## Implemented boundary

The separate syntax package supplies source understanding for a
checking representation and authored span maps. The content mapper exposes those
to TypeScript. This is tooling; application compilation stays in compiler-next's
existing pipeline. The mapper does not implement refs or emit a second runtime.

Preserve identifiers, ordinary expressions and types verbatim where possible.
Generated nodes must not acquire fabricated authored declarations. Check both
reads and writes for refs and bindings. A diagnostic mapped near an expression
is not sufficient evidence that rename or completion edits are safe.

`projectForChecking()` is exported through `@memoized-dom/jsx-plus/checking`.
It imports `normalize()` directly, retaining standard TSX and exact copied-span
mappings without loading the production compiler facade. Protocol mappings are
verbatim tuples; generated syntax has no editable counterpart. TypeScript's
own `SpanMap` verifies an identifier maps exactly and a generated brace does not.

`checking/spans.ts` adds one zero-length **end anchor** after each copied span
that generated text follows. Without it, the cursor at the end of `onClick=focus`
or `<p>focus</p>` falls on the exclusive end of a span before a generated `}`.
TypeScript maps that virtual position back with `None` fidelity and silently
drops completions that edit the file. Auto-imports vanish while ordinary
suggestions remain. Investigation (2026-11-11) also ruled out the other
candidates. Atom spans for the braces did not help. A completion-side split
for touching boundaries was unnecessary once anchors existed, so it was removed.
Anchors add no characters to any mapping. Generated braces stay unmapped, as
`tests/checking.test.ts` verifies with `SpanMap`.

Auto-import suggestions are a client preference. The TS7 server asks for the
`js/ts`, `typescript`, `javascript` and `editor` configuration sections; the test
client answers `suggest.autoImports: true`, VS Code's default.

The primary TSX view keeps normal narrowing and editor identity. Compiler-owned
facts select regions checked through a supplemental TSX view with widened state
seeds and possible prop writes. Diagnostic directives delegate only those ranges;
the supplemental view checks them and ignores the complement. Its copied mappings
disable editor features, preventing duplicate rename/completion edits. Generated
insertions stay unmapped. See [checking flow](checking-flow.md) for the bounded
profile, coverage tests and unsupported-input fallback.

On a `JsxPlusError`, [bounded recovery](recovery.md) can quarantine damaged markup
lines while retaining the error and checking unaffected mapped code. Ordinary
host syntax errors are left to native TypeScript recovery. Structurally unsafe
cases retain an empty unmapped module. Unexpected internal failures still reach
the host's mapper-failure handling; old successful text is never substituted.

The [research in dx.md](../dx.md#3-research-typescript-content-mappers) links the
protocol, permissions and mapping constraints. Use its exact-verbatim edit rule
and recheck the pinned version when advancing P3. Preserve a note of the actual
TypeScript/editor versions and permissions used by the probe.

## Existing files and planned work

| Path relative to repository root | State and role |
| --- | --- |
| `package.json` | Existing TypeScript version pin; repository checks stay on `bun check` |
| `packages/compiler-next/tests/reference/typescript.ts` | Existing independent reference lowering; do not reuse the new production lowering as its oracle |
| `packages/language-service/src/plugin.ts` | Existing TS6 plugin; the mapper needs its own integration plan |
| `wiki/compiler/typescript.md` | Existing API notes and compatibility limits |
| `packages/jsx-plus/src/source.ts` | Existing exact copied-span mappings for normalized TSX; generated syntax has no authored edit span |
| `packages/jsx-plus/src/checking/project.ts` | Paired TSX projection and authored parse diagnostics |
| `packages/jsx-plus/src/checking/protocol.ts` | Checking outputs, feature masks and diagnostic-directive tuples |
| `packages/jsx-plus/src/checking/flow/plan.ts` | Compiler-fact selection of state/prop insertions and dependent checking regions |
| `packages/jsx-plus/src/checking/flow/syntax.ts` | Index parents and include receiving declarations/opening elements in diagnostic routing |
| `packages/jsx-plus/src/checking/flow/render.ts` | Supplemental assembly, composed maps and complementary diagnostic routing |
| `packages/jsx-plus/tests/checking-projection.test.ts` | Coverage of delegated spans, overlap merging, unmapped scaffolding and lowering fallback |
| `packages/jsx-plus/src/checking/facts.ts` | Opt-in public compiler inspection and authored fact locations |
| `packages/jsx-plus/tests/checking-facts.test.ts` | Identity/provenance, mapping fidelity and lowering-coordinate tests |
| `packages/jsx-plus/src/mapper/server.ts` | JSON-RPC process, UTF-16 negotiation and independent cache lifetimes by project handle |
| `packages/jsx-plus/src/mapper/project.ts` | One latest exact filename/content checking result per open project |
| `packages/jsx-plus/tests/mapper-cache.test.ts` | Real task-board projections, reuse counts, edits, eviction, parse errors and project isolation |
| `packages/jsx-plus/package.json` | Private prototype mapper manifest and checking export; launches through Bun |
| `packages/jsx-plus/tests/checking.test.ts` | Projection/edit fidelity, lifecycle and actual TypeScript CLI checks |
| `packages/jsx-plus/tests/mapper-lsp.test.ts` | Actual LSP rename, authored Unicode diagnostic and incomplete/restore edit cycle |
| `packages/jsx-plus/tests/rpc.ts` | Test-only framed transport/process cleanup and UTF-16 position helpers |
| `packages/jsx-plus/examples/checking/App.auwla` | Valid typed-prop/ref example used by CLI and LSP checks |
| `packages/jsx-plus/examples/checking/TypeError.auwla` | Deliberate string-method error after an emoji |
| `packages/jsx-plus/examples/checking/tsconfig.json` | Local prototype registration and existing JSX type declarations |
| `packages/jsx-plus/examples/checking/tsconfig.error.json` | Selects the deliberate failure as its only authored file |

Prototype imports use the explicit working extension, for example
`./Counter.auwla`; registration is not a promise of extensionless resolution.
Formatting, highlighting and CSS support need separate plans for the whole grammar.

## Verified toolchain and transport

Verified on Windows with installed `typescript@7.1.0-beta`, package git head
`3e9236361fa97a9e6c685f4833ac457ae2d8c50a`, and `vscode-jsonrpc@9.0.2`.
The normalizer remains on yuku 0.19.0. Bun runs the mapper from this workspace;
the private manifest is not a published cross-runtime distribution contract.

The [upstream protocol](https://github.com/microsoft/typescript-go/pull/4712)
defines initialize/openProject/transform/closeProject over framed JSON-RPC.
The prototype negotiates UTF-16, stores open handles independently, rejects
closed handles and unknown options, and drops handle state on close. It adds
a [bounded transform cache](mapper-cache.md): one latest filename/content result
per project, replaced on edit and discarded on close or every reopen. There is
no dynamically discovered configuration. The real task-board sequence performs
five projections for seven requests, with no AST/edit history retained.

`vscode-jsonrpc/node` selects Node-compatible stream transport, supported by Bun;
it does not require the VS Code editor. The mapper talks to TypeScript. An IDE
needs a compatible TypeScript content-mapper integration; no other IDE or VS Code
extension activation has been verified by this headless probe.

From the repository root, this runs the pinned TypeScript CLI explicitly:

```text
bun node_modules/typescript/lib/tsc.js --project packages/jsx-plus/examples/checking/tsconfig.json --runExternalCode --pretty false
```

The valid example exits zero. Changing the project filename to
`tsconfig.error.json` reports the intended authored `TS2551` error and exits two.
Omitting mapper execution permission reports `TS18068`. This command exercises
the mapper host; routine repository type checking stays on `bun check`.

The installed beta's LSP binary starts with `--lsp --stdio`. The probe sets
`initializationOptions.runExternalCode: true`, sends `initialized` before opening
files and responds to capability registration. Passing `--runExternalCode` after
`--lsp` is rejected by this pinned binary's LSP flag parser; do not copy that CLI
ordering into an editor launch configuration. Editor trust/permission UX remains
unverified; the test records its actual headless initialization settings.

## First probe and acceptance examples

Use a tiny file with a typed prop, quoted text, a direct expression and a normally
declared ref. Include a deliberate wrong expression and an incomplete edit.

| ID | Evidence required |
| --- | --- |
| TOOL-01 | Built: CLI reports the authored error location; LSP checks the full UTF-16 range after an emoji |
| TOOL-02 | Built for the probe: actual LSP ref rename updates four uses and changing-state rename updates five; applying edits and rechecking yields no errors |
| TOOL-02-ID | Built: actual task-board bare submit-handler rename updates its declaration and attribute use; authored edits apply and recheck without errors |
| TOOL-03 | Partial: real task-board member completion resolves and applies an exact authored insert/replace edit inside a parenthesized attribute, then rechecks. Auto-import of `focusTaskInput` from `./actions` at the end of a bare attribute and a child expression applies both edits and reproduces the authored file (`tests/handler-import-lsp.test.ts`). Broader completion contexts remain open |
| TOOL-04 | Partial: actual unfinished task-board quote/parenthesis edits retain unrelated diagnostics/completion; holes are unmapped, builds still fail, restoration clears errors. Multiline structural recovery remains open |
| TOOL-05 | Hardened paired profile: 34 actual LSP targets pass, including receiving-type errors, generic helpers and deferred/immediate callbacks. Full flow acceptance remains open; see [checking flow](checking-flow.md) |
| TOOL-06 | Partial: exact unchanged input reuses the full result; real-example reuse/eviction/isolation counts pass. Incremental edits, measured latency and heap acceptance remain open |

Start with TOOL-01 and TOOL-02 during P2/P3; expand as grammar grows. Keep failing
edits as regression fixtures when the parser or mapping strategy changes.

## Editor extension (planned, P3-EDITOR)

Accepted direction (DX-36): editor integrations must be decoupled so other editor
extensions can reuse the language tooling without installing or importing the
VS Code extension. The existing projection and mapper remain the shared core;
the first VS Code adapter is built in `packages/editor-vscode`. Desktop activation
and packaged installation remain unverified.

The content mapper supplies checking text and mappings to TypeScript, whose
language server provides diagnostics, completion, rename and auto-imports. An
editor still needs an adapter for:

- Language registration: the `auwla` language id, `.auwla` files, comments and
  brackets, so the editor sends those files to the TS7 server.
- Highlighting: mappers return positions, not colors. A TextMate grammar
  derived from TSX must add quoted children and direct `if` blocks.
- Formatting: the TSX formatter cannot parse `.auwla`; this needs its own plan.

TypeScript 7.1's package exports a VS Code extension API
(`typescript/vscode`, `dist/vscode/extensionApi.d.ts`). Its
`registerContentMappers(contributorId, [{ extensions, inferredProjectContribution }])`
registers a mapper, including for files outside any tsconfig.
`registerLspMiddleware` can adjust language-feature responses. The adapter uses
only mapper registration, typed against the installed declarations. Its provider
is `TypeScriptTeam.native-preview`, as in the pinned
[TypeScript extension manifest](https://github.com/microsoft/TypeScript/blob/3e9236361fa97a9e6c685f4833ac457ae2d8c50a/packages/vscode-typescript/package.json).
The local VS Code 1.145.3 built-in TypeScript extension does not expose this API.
At the user's request, `TypeScriptTeam.native-preview` 1.0.2 and the local Auwla
VSIX 0.0.2 are installed and confirmed in `code --list-extensions --show-versions`.
The installed provider bundle contains mapper registration. Desktop activation
and diagnostics were observed after choosing the workspace SDK. The 0.0.2 quoted
interpolation update still needs a desktop reload; its language features are
verified through the real LSP tests below.

Implemented layout (other editor adapters remain planned):

| Layer | Where | Shared by |
| --- | --- | --- |
| Normalizer and checking projection | Existing `packages/jsx-plus/src/`; checking export `@memoized-dom/jsx-plus/checking` | Builds and editor integrations; no editor SDK imports |
| Content-mapper server | Existing `packages/jsx-plus/src/mapper/server.ts`, registered in the package manifest | Compatible TypeScript hosts; no VS Code activation dependency |
| Editor metadata | `packages/jsx-plus/src/editor/registration.ts`, export `./editor` | Language id, extensions and local mapper contribution for any compatible host |
| Highlighting assets | `packages/jsx-plus/editor-assets/`, transformation `src/editor/grammar.ts` (`./editor/grammar`) | Standalone TSX-derived TextMate grammar and comment/bracket configuration |
| VS Code adapter | Separate `packages/editor-vscode/`; activation and declarative language/grammar registration | VS Code only; consumes shared tooling and assets |
| Other editor adapters | Planned separate integration packages, including third-party extensions | Consume the same tooling without depending on `editor-vscode` |

Dependencies go from an editor adapter to the shared tooling. The normalizer,
checking projection, recovery and mapper must never import `vscode`, an editor
adapter, or require editor activation. Shared assets also remain outside the
VS Code package. Editor-specific settings and permission prompts belong to the
adapter, not the language implementation. New language behavior is implemented
and tested in the shared core rather than repeated in extension callbacks.

The shared grammar builder clones an unmodified, pinned Microsoft TSX grammar,
replaces its child rule with host statements and adds the two attribute forms.
It emits a standalone grammar with no external `source.tsx` registration needed.
The vendor license is retained and copied into the adapter output. Tests use the
actual TextMate/Oniguruma engines: the real task board has no invalid tokens or
leaked lexical states, and quotes containing closing tags, nested parentheses
and template interpolation retain their contexts. This is highlighting evidence,
not parser conformance.

The registration export reads the existing mapper manifest, adds an absolute
file-directory URI and returns plain protocol data. A headless test launches that
exact command and transforms the real task board. Adapter tests simulate the
editor/provider API to check registration, missing/incompatible providers, errors
and disposal. They are not a real activation check. `scripts/build.ts` bundles
only the adapter and emits shared assets into `dist/`; it does not bundle the
compiler, mapper process or Bun into a self-contained VSIX.

The local VSIX excludes workspace dependencies. Installed activation resolves
`@memoized-dom/jsx-plus` from open file-based workspace folders, with an
adapter-directory fallback for development hosts (`src/mapper-package.ts`). Its
regression test places the simulated extension outside the checkout and resolves
the actual task-board workspace. Other projects need the shared package installed;
the local VSIX is not a portable standalone mapper distribution.

Live debugging exposed an SDK mismatch: the provider's bundled TypeScript 7.0.2
rejected `custom/setContentMapperContributions`. Selecting this workspace's
7.1.0-beta SDK enables registration. `.vscode/settings.json` points to that SDK;
the native provider still requires the user's workspace-version selection.
Adapter 0.0.1 logs SDK initialization/version events and warns about old servers,
with an action invoking the native provider's own version picker. The command
palette is Ctrl+Shift+P with a leading `>`, not the file picker.

The `./types` declaration export imports the existing framework type contract.
Projects enable it once with `compilerOptions.types: ["@memoized-dom/jsx-plus/types"]`
and preserve markup with `jsx: "preserve"`. The counter's examples config inherits
that setup; new top-level `.auwla` files are included without per-file type imports.
Native TypeScript diagnostics still use the term JSX because they check the TSX
view. No diagnostic wording is rewritten or suppressed. The real registration
test verifies a clean counter, `count: number` hover and the authored 2339 range
for `count.toUpperCase()`. Standalone inferred-project JSX type setup is still open.

Quoted interpolation (DX-37, spec r7) is checked as a native template. The real
counter LSP test applies completion edits in `{cou}`, asks for hover inside the
quotes, renames the binding through all three authored uses and rechecks. It also
completes empty `{}` and unfinished `{cou` with or without the outer quote.
Checking-only repairs remain unmapped and production parsing stays strict.

The shared TextMate grammar now adds quoted substitutions and direct child
control blocks. Embedded expressions are marked as code and mapped to TypeScript
in the VS Code contribution. Tests compare encoded tokenizer attributes with
plain code and literal text: an interpolated identifier must not remain a string
token, or normal string-completion settings would suppress suggestions. The
adapter still provides only registration/assets; shared normalization and the
TypeScript host own checking and completion.

See [adapter setup](../packages/editor-vscode/README.md) and
[reuse from another editor](../packages/jsx-plus/editor-assets/README.md).

The mapper transport is not a standalone language server. An editor needs a
TypeScript host with content-mapper support and registration, or an additional
bridge; ordinary LSP support alone does not establish compatibility. A second
adapter must document and verify that host integration. Editors using a different
highlighting format need separate assets; a TextMate grammar does not imply
tree-sitter support.

P3-EDITOR acceptance: keep existing headless CLI/LSP tests passing without the
VS Code package, check the dependency direction, document how another extension
launches/registers the shared mapper, and verify VS Code activation separately.
Until a second editor is exercised, cross-editor support remains a design boundary
with headless evidence, not a verified compatibility claim.

## Open questions

Published packaging, editor extension registration, inferred projects,
declaration output, incremental invalidation beyond exact input, multi-module editing and the editor
version matrix remain open. Broader completion, formatting, cross-file
rename and broader generated-region diagnostics need their own evidence.

TOOL-05 remains open beyond the 34-case profile: ref writes, complete replay
proofs, contextual typing, aliases, live imports and lowering maps need more
evidence. Selected ranges receive native supplemental checking rather than blanket
error suppression. The primary view still supplies editor features, so flow-aware
hover/completion behavior requires separate work. A custom extension also does
not automatically inherit a TSX formatter or CSS tooling.

The [checking-flow catalog](checking-flow.md) and strict LSP gate now pass all
34 targets. Receiving declarations/opening elements are included because native
assignability errors can begin outside the selected expression. Typed identity
calls validate copied seeds before widening; generated helpers have no editable
mapping. The ordinary mapper uses the compiler's read-only public facts;
it stops before compiler planning/emission and does not emit application code.
