# Architecture and code map

State: syntax, host-context hardening and an initial TypeScript mapper built in `packages/jsx-plus`.
Updated: 2026-11-13. Existing compiler/runtime features, including refs, are built.
Owns DX-28/DX-31 and the integration side of DX-03.

## One production compilation path

JSX+ is a standalone template layer (DX-39). For builds it is one pure value,
`auwla` (`src/language.ts`): a compiler-next **source language** that owns `.auwla`
and turns a module's text into TSX with an origin back to the authored text.
Compiler-next does everything else, as for any `.tsx` module: collecting imports
across files, routes, planning, emission, source maps, error positions,
projects and applications, the CLI, the Bun plugin and the Vite plugin with hot
updates. JSX+ has no project wrapper, build graph, bundler plugin or source-map
composer, and no Bun or Node API in `src/`, so it runs wherever compiler-next runs.

Pass it to any compiler-next entry: `compileModules(files, { languages: [auwla] })`,
`createProject({ ..., languages: [auwla] })`, compiler-next's Bun plugin, or the
Vite plugin (`memoizedDom({ compiler: 'next', languages: [auwla] })`). `compile()`
is a one-module convenience over compiler-next's `compile` with that option. The
hook is compiler-next's ([source languages](../wiki/compiler/core.md#source-languages));
it names no particular language. Extended syntax and checking stay in
`packages/jsx-plus`. Compiler-next's `src/analysis/` folder exposes a read-only
snapshot of the same frontend for checking.

The synchronized compiler baseline is `compiler-rewrite` at `07e996c9`. `.auwla`
server functions are not yet recognized (compiler-next's `server/` still accepts
only JS/TS files). Client features are checked in `.auwla`: routes, lazy route
chunks, the data layer, `$routed` and effects (`examples/team`).

```text
.auwla text --(SourceLanguage `auwla`, packages/jsx-plus)--> TSX + origin
                                          |
existing JS/TS/JSX/TSX --------------------+
                                          |
      compiler-next: project/collect, compile, Bun plugin, Vite plugin
                                          |
                                      parse
                                          |
         resolve -> graph -> plan -> optimize -> emit
               existing compiler-next pipeline
                     |
       application DOM/SSR output, source maps to .auwla

the same source understanding
  -> checking projection + TypeScript span mappings
  -> content mapper / CLI / editor (tooling only)
```

Ordinary JS/TS regions need real parser support and preserved ranges. Extended
markup needs a defined grammar and recoverable syntax tree. Avoid one parser for
checking and an unrelated parser for production. Do not use regular-expression
replacement as the general parser for nested code and markup.

Normalizing extended syntax is this package's task. Yuku's real host tokens and
AST delimit code; equal-width temporary masks preserve authored offsets while
scanning nested markup. Emitted TSX is assembled from copied spans and generated
syntax, never from those masks. Existing compiler-next parses that TSX normally.
Host fragments use a permissive async/generator parser context to retain `yield`
and `await` expression grammar. That context is parser input only, never emitted
or evaluated; the completed module is validated in its actual enclosing context.
Parser-owned AST nodes keep their offsets; a token view and explicit origin
translate fragment positions back to authored ranges.

Explicit top-level semicolons divide child chunks. Each is tried as a host
expression before falling back to statements/ASI. Conditional bodies are parsed
as child bodies and cached before their contents are blanked for the outer `if`
parse, preserving line breaks and offsets. This keeps object/function/class
expressions from being reinterpreted as declarations or blocks after a sibling.
The current implementation reparses while discovering nested markup; it makes
no frontend performance claim. The checking projection now reuses this normalizer
directly and serializes its copied spans for TypeScript. Its separate checking
entry avoids loading the compiler facade. Specialized reactive-flow scaffolding
now lives in `checking/flow/`: a primary view retains editor identity and ordinary
narrowing while selected dependent regions use supplemental TypeScript checking.
Read-only compiler facts select the profile; no DOM planning/emission runs.

## Owned implementation files

All paths are relative to the repository root and exist now.

| Path | Responsibility |
| --- | --- |
| `packages/jsx-plus/src/normalize.ts` | Public `normalize`/`normalizeForChecking`: find root markup in host code, assemble TSX, validate the host module |
| `packages/jsx-plus/src/markup/context.ts` | Per-file reader state: source, filename, cached conditional blocks and authored error reporting |
| `packages/jsx-plus/src/markup/element.ts` | Opening tags and attribute values, then the body scan: nested markup, child-level `if`/`else` blocks and the closing tag |
| `packages/jsx-plus/src/markup/children.ts` | Child grammar: `;` chunks, expression-first parsing, ASI statements, direct `if` and `for` lowering and chunk diagnostics |
| `packages/jsx-plus/src/host.ts` | Parser-only fragment context, token slices, tag-opening/delimiter/unterminated-literal token helpers |
| `packages/jsx-plus/src/checking/host-recovery.ts` | Bounded parser-only expression slots and original-coordinate restoration; emitted checking text keeps the authored incomplete expression |
| `packages/jsx-plus/src/masks.ts` | Every parser-only mask: equal-width, line-preserving blanks for markup, attribute values and quarantined lines |
| `packages/jsx-plus/src/attributes/value.ts` | Attribute value contract: replacement pieces plus the mask that hides that form from the tag lexer |
| `packages/jsx-plus/src/attributes/parenthesized.ts` | Balanced `=(...)` reader with nested-markup normalization |
| `packages/jsx-plus/src/attributes/identifier.ts` | Bare `=identifier` host validation and copied identifier span |
| `packages/jsx-plus/tests/attributes.test.ts` | Attribute host forms, copied spans, malformed literals and explicit source-format boundary |
| `packages/jsx-plus/src/model.ts` | Syntax views, authored ranges and copied-span mapping types |
| `packages/jsx-plus/src/source.ts` | Copied/generated pieces, assembly, exact authored-offset lookup (edits) and nearest/covering lookups (diagnostics, syntax ranges) |
| `packages/jsx-plus/src/diagnostics.ts` | Authored syntax diagnostic ranges and line/column reporting; `JsxPlusError` is a compiler-next `CompileError` |
| `packages/jsx-plus/src/language.ts` | `auwla`, the compiler-next source language: `normalize` plus a binary-search origin over copied spans. JSX+'s whole build integration |
| `packages/jsx-plus/src/compile.ts` | One-module convenience: compiler-next's `compile` with `languages: [auwla]` |
| `packages/jsx-plus/tests/modules.test.ts` | The notes example through compiler-next's project and Bun plugin: both modes executed, source maps, authored errors |
| `packages/jsx-plus/tests/vite.test.ts` | The notes example through compiler-next's Vite plugin: build, dev transform and map, hot update, authored dev error |
| `packages/jsx-plus/examples/notes/` | Multi-file app: three `.auwla` components, explicit and extensionless imports, a `.ts` re-export and helper |
| `packages/jsx-plus/examples/preview.ts` | Example preview: compiler-next's Bun plugin with `auwla` and chunk splitting, serving the folder, an optional API and deep links |
| `packages/jsx-plus/examples/checkout.ts` | Example/test-only Bun resolver: this checkout's runtime, data and router sources instead of their `dist` |
| `packages/jsx-plus/examples/team/` | Routes, lazy route pages, `$fetch`/`$track` through a helper, `$routed`, `$effect`, `$cleanup` |
| `packages/jsx-plus/tests/routes.test.ts` | The team example bundled with splitting and loaded with `import()`: chunks, both-mode navigation/data/effects, deep link; a fresh window per app |
| `packages/jsx-plus/src/index.ts` | Public package exports |
| `packages/jsx-plus/tests/parse.test.ts` | Spec views/errors, lexical boundaries and mapping checks |
| `packages/jsx-plus/tests/host.test.ts` | Host contexts, semicolon chunks, cached child ranges, native suspension and malformed-input regressions |
| `packages/jsx-plus/tests/compile.test.ts` | Extended-source execution, existing refs and keyed nodes |
| `packages/jsx-plus/examples/counter.auwla` | Complete counter compiled and clicked by the execution tests |
| `packages/jsx-plus/examples/README.md` | Authoring walkthrough and commands for real examples |
| `packages/jsx-plus/examples/task-board/` | Full authored UI with direct `if` and `for` in its template, browser entry/HTML/CSS, preview (shared helper) and native mapper config |
| `packages/jsx-plus/tests/loops.test.ts` | Direct-loop normalization: destructuring, nesting, multi-child rows, rejected forms, exact binding/iterable spans |
| `packages/jsx-plus/AGENTS.md` | Package ownership boundary and focused checks |
| `packages/jsx-plus/src/checking/project.ts` | Shared-normalizer TSX checking projection and authored parse diagnostics |
| `packages/jsx-plus/src/repairs.ts` | Checking-only closer suggestions attached to authored reader errors; builds ignore them |
| `packages/jsx-plus/src/checking/recovery/markup.ts` | Bounded current-source repair search, inserted closers and quarantined ranges, exact authored spans and structural fallback |
| `packages/jsx-plus/src/editor/registration.ts` | Shared metadata and local mapper launch contribution; no editor SDK |
| `packages/jsx-plus/src/editor/types.d.ts` | Opt-in project-level `./types` export reusing existing framework element/event/ref declarations |
| `packages/jsx-plus/src/markup/text.ts` | Host-token interpolation boundaries, native template pieces and copied authored spans |
| `packages/jsx-plus/tests/interpolation.test.ts` | Quoted-text parsing, escaping, scope, errors and exact mappings |
| `packages/jsx-plus/tests/interpolation-lsp.test.ts` | Real completion, hover, rename and unfinished-input checks inside the authored counter |
| `packages/jsx-plus/src/editor/grammar.ts` | Build-time TSX grammar transformation, separate from parsing/checking |
| `packages/jsx-plus/editor-assets/` | Shared configuration and pinned upstream grammar/license |
| `packages/jsx-plus/tests/editor-assets.test.ts` | Real-example TextMate/Oniguruma tokenization and actual contributed mapper launch |
| `packages/jsx-plus/tests/editor-registration-lsp.test.ts` | Real editor registration request, clean counter diagnostics, authored type error and hover without a per-file type import |
| `packages/editor-vscode/src/extension.ts` | Separate adapter activation, compatible-provider check and registration/disposal |
| `packages/editor-vscode/src/mapper-package.ts` | Resolve the project's shared mapper for installed adapters; development-directory fallback |
| `packages/editor-vscode/scripts/build.ts` | Adapter bundle and shared grammar/configuration/license output |
| `packages/editor-vscode/tests/activation.test.ts` | Simulated editor/provider API contract; desktop activation not inferred |
| `packages/jsx-plus/tests/recovery.test.ts` | Real malformed-source mappings and strict build rejection |
| `packages/jsx-plus/tests/editor-recovery-lsp.test.ts` | Native diagnostics/completion beyond actual unfinished task-board edits |
| `packages/jsx-plus/tests/host-recovery.test.ts` | Incomplete conditions/iterables/member expressions, exact LF/CRLF spans, cursor anchors and strict build rejection |
| `packages/jsx-plus/tests/host-recovery-lsp.test.ts` | Native completion edits inside unfinished conditions, loops, attributes, handlers and interpolation using the greeting example |
| `packages/jsx-plus/src/checking/spans.ts` | Serialize copied spans for TypeScript, adding zero-length end anchors before generated text (edit-producing completions such as auto-import) |
| `packages/jsx-plus/tests/handler-import-lsp.test.ts` | Native completion plus auto-import edit for a half-typed handler in a bare attribute and a child, applied to authored text |
| `packages/jsx-plus/src/checking/protocol.ts` | Primary/supplemental outputs, mapping masks and diagnostic directives |
| `packages/jsx-plus/src/checking/flow/plan.ts` | Consume public compiler facts; select bounded state/prop insertions and dependent regions |
| `packages/jsx-plus/src/checking/flow/syntax.ts` | Separate parent index and receiving diagnostic contexts; parser AST stays unchanged |
| `packages/jsx-plus/src/checking/flow/render.ts` | Assemble supplemental TSX, compose exact spans and route diagnostics by region |
| `packages/jsx-plus/tests/checking-projection.test.ts` | Delegated coverage, generated spans, merged ranges and lowering fallback |
| `packages/jsx-plus/src/checking/facts.ts` | Opt-in public fact adapter with explicit authored mapping fidelity |
| `packages/jsx-plus/tests/checking-facts.test.ts` | Identities, shadowing, capture, mapping and lowered-coordinate refusal |
| `packages/jsx-plus/src/mapper/server.ts` | Headless TypeScript JSON-RPC transport and project handles |
| `packages/jsx-plus/src/mapper/project.ts` | One latest checking result per project, keyed by exact filename and source |
| `packages/jsx-plus/tests/mapper-cache.test.ts` | Real authored-source reuse counts, edit/file eviction, diagnostics and isolated lifetimes |
| `packages/jsx-plus/tests/checking.test.ts` | Exact span fidelity, mapper lifecycle and native CLI acceptance |
| `packages/jsx-plus/tests/mapper-lsp.test.ts` | Native LSP rename, Unicode diagnostics, applied task-board member completion and incomplete/restore editing |
| `packages/jsx-plus/tests/rpc.ts` | Test-only process lifecycle, example roots and position helpers |
| `packages/jsx-plus/tests/lsp.ts` | Test-only TypeScript LSP session (`withLanguageServer`), single-file edit and rename application helpers |
| `packages/jsx-plus/tests/fixtures/checking-flow.json` | Target checking diagnostics and source spans for replay, refs, row scope and synchronous host logic |
| `packages/jsx-plus/tests/probe-flow.ts` | Actual LSP observation/strict catalog runner; 34 targets match; accepts reduced case sets for investigation |
| `packages/jsx-plus/tests/checking-flow.test.ts` | Assert all 34 flow/scope targets; full TOOL-05 acceptance explicitly unclaimed |
| `packages/jsx-plus/examples/checking/` | Valid/intentional-error authored files and local mapper configs |

## Existing files to reuse

All paths below are relative to the repository root and currently exist.

| Path | Role and boundary |
| --- | --- |
| `packages/compiler-next/src/core/parse/index.ts` | Parse entry; reads a language module as the TSX `auwla` gives (DX-34 change, `languages.ts`) |
| `packages/compiler-next/src/core/parse/languages.ts` | The source-language hook, its error relocation and probing extensions |
| `packages/compiler-next/src/core/parse/lower-typescript.ts` | Existing runtime TypeScript lowering; do not invent a second TS semantics implementation |
| `packages/compiler-next/src/pipeline.ts` | Existing production pipeline, now sharing the frontend with inspection |
| `packages/compiler-next/src/analysis/` | Public inspection and serialized facts; owned by [compiler analysis](../wiki/compiler/analysis.md) |
| `packages/compiler-next/src/options.ts` | Existing compile options forwarded by the UI facade |
| `packages/compiler-next/src/features/refs/` | Current ref classification, planning and emission; see [refs](refs.md) |
| `packages/compiler-next/src/features/conditionals/` | Existing reactive branch machinery |
| `packages/compiler-next/src/core/emit/row-list.ts` | Emits compiled keyed row factories |
| `packages/runtime/src/row-list.ts` | Existing compiled-row reconciliation and identity machinery |
| `packages/runtime/src/list-values.ts` | Existing general array-child traversal and row matching |
| `packages/compiler-next/tests/cases/` | Existing behavioral comparison cases for compatibility |
| `packages/compiler-next/tests/reference/typescript.ts` | Independent TypeScript lowering in the test reference |
| `packages/language-service/src/plugin.ts` | Existing TS6 plugin; a content mapper is a separate integration, not a drop-in plugin replacement |
| `packages/vite/src/graph/collector.ts` | Production graph collection and compilation; integration is later work |

Existing implementation contracts stay on their [compiler pages](../wiki/compiler/README.md).
If shared machinery changes, update that page as well as the owning prototype page.

The extension contract now exists under [spec/](spec/README.md): grammar, syntax
view/schema, semantics, diagnostics, fixtures and [check.ts](spec/check.ts).
The spec checker validates fixtures and current-JSX equivalents; package tests
separately parse/compile extended source. Neither adds a second reactive compiler.

## Backend authoring (planned)

`.auwla` can also be used for pure backend JavaScript/TypeScript, with ordinary
imports such as Express and database packages. Project configuration will point
to backend files and/or folders. Those files use ordinary nonreactive backend
execution within the same compiler-next toolchain; the extension does not opt
them into UI reactivity. Exact config keys and loading integration remain open.

Isomorphic support will be added later. This note records the direction without
adding that work to the current markup-parser slice.

## Proposed placement

The initial checking and mapper directories now exist and are mapped above.
Shared checking, recovery, caching and mapper code stay in this package.
Under DX-36, editor adapters are separate packages and depend on the shared
tooling; the shared tooling never depends on an editor SDK or adapter. The
first VS Code package and reusable highlighting assets are mapped in
[tooling.md](tooling.md#editor-extension-planned-p3-editor). Map actual files in
the commit that introduces them.
Split [features.md](features.md) when a feature group needs its own files and cases.

## Boundaries

- New syntax reuses existing writes, reactivity, readiness, refs and ownership.
- Prototype production code uses compiler-next's public exports. Keep implementation
  out of its source folders; changes there are separate work, not package setup.
- Ref compatibility checks confirm those features survive the new syntax; they
  are not tasks to implement refs again.
- Existing `.tsx` keeps its normal text and expression-container grammar.
- Source-format selection is explicit; do not guess a language from quote usage.
- The mapper must not run full production DOM compilation on every keystroke.
- Keep TypeScript checking spans separate from runtime/debugging source maps.
- Keep the reference independent of the new production parser/lowerer when
  asserting output; use separately authored equivalents and explicit assertions.
- A prototype does not replace the compiler/Vite public result contract or close
  its SSR, request-isolation, routing and performance acceptance gates.

## Open questions

Broader host contexts, malformed-input recovery and scanner reparse costs need
hardening beyond the first fixtures. Multi-module `.auwla` resolution, Vite,
editor activation/registration, complete flow-aware tooling, final-JavaScript
source maps and delivery remain open. The mapper has headless CLI/LSP evidence,
not an editor acceptance claim. Backend config remains planned. The facade
currently adapts one UI module; broader capabilities are not inferred from it.
