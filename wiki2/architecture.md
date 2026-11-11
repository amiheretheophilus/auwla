# Architecture and code map

State: initial syntax and host-context hardening built in `packages/jsx-plus`.
Updated: 2026-11-11. Existing compiler/runtime features, including refs, are built.
Owns DX-28/DX-31 and the integration side of DX-03.

## One production compilation path

JSX+ adds authoring features in a separate syntax package. Its normalizer returns
standard TSX, syntax views and authored mappings; its UI `compile()` facade calls
compiler-next's public API. Compiler-next owns every existing production stage
and runtime decision. Prototype source stays in `packages/jsx-plus`; no existing
compiler-next/runtime/data source files have been modified for this slice.

```text
JSX+ source -> packages/jsx-plus -> normalized standard TSX
                                          |
existing JS/TS/JSX/TSX --------------------+
                                          |
                             compiler-next public API
                                          |
                                      parse
                                          |
         resolve -> graph -> plan -> optimize -> emit
               existing compiler-next pipeline
                     |
              application DOM/SSR output

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
no frontend performance claim. A future checking projection shares this syntax
understanding while producing TypeScript-specific scaffolding.

## Owned implementation files

All paths are relative to the repository root and exist now.

| Path | Responsibility |
| --- | --- |
| `packages/jsx-plus/src/normalize.ts` | Host-token scanning, nested markup, expression/conditional children and TSX normalization |
| `packages/jsx-plus/src/host.ts` | Parser-only fragment context, token slices and untouched host AST offsets |
| `packages/jsx-plus/src/model.ts` | Syntax views, authored ranges and copied-span mapping types |
| `packages/jsx-plus/src/source.ts` | Copied/generated pieces, assembly and exact authored-offset lookup |
| `packages/jsx-plus/src/diagnostics.ts` | Authored syntax diagnostic ranges and line/column reporting |
| `packages/jsx-plus/src/compile.ts` | Single-UI-module public-API delegation and mapped compiler diagnostics |
| `packages/jsx-plus/src/index.ts` | Public package exports |
| `packages/jsx-plus/tests/parse.test.ts` | Spec views/errors, lexical boundaries and mapping checks |
| `packages/jsx-plus/tests/host.test.ts` | Host contexts, semicolon chunks, cached child ranges, native suspension and malformed-input regressions |
| `packages/jsx-plus/tests/compile.test.ts` | Extended-source execution, existing refs and keyed nodes |
| `packages/jsx-plus/examples/counter.auwla` | Complete counter compiled and clicked by the execution tests |
| `packages/jsx-plus/AGENTS.md` | Package ownership boundary and focused checks |

## Existing files to reuse

All paths below are relative to the repository root and currently exist.

| Path | Role and boundary |
| --- | --- |
| `packages/compiler-next/src/core/parse/index.ts` | Unchanged parse entry receiving standard TSX from the syntax package |
| `packages/compiler-next/src/core/parse/lower-typescript.ts` | Existing runtime TypeScript lowering; do not invent a second TS semantics implementation |
| `packages/compiler-next/src/pipeline.ts` | Unchanged production pipeline, reached through its public exports |
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

These paths are **planned**, not existing files. Keep additional syntax/tooling
work in the separate package; exact filenames can change during the experiment.

| Planned path | Responsibility | Owns details |
| --- | --- | --- |
| `packages/jsx-plus/src/checking/` | Virtual TypeScript and authored spans; tooling projection only | [tooling](tooling.md) |
| `packages/jsx-plus/src/mapper/` | Mapper transport/configuration/cache; transport packaging remains open | [tooling](tooling.md) |

Confirm or revise exact placement during P1/P2 before adding directories. Update this
table with actual files in the same commit that introduces them. One concept
page must own each new implementation file; split [features.md](features.md) when
one of its feature groups starts needing its own files and cases.

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
actual TypeScript mapper integration, final-JavaScript source maps and delivery
are not built. Backend config remains planned. The facade currently adapts one
UI module; none of these future capabilities is inferred from that first slice.
