# Architecture and code map

State: existing compiler integration points plus proposed prototype boundaries.
Updated: 2026-11-10. No prototype implementation exists yet.

## Data flow to investigate

```text
authored source + file identity
  -> shared source-aware parser (planned)
       -> runtime lowering + authored mappings
            -> existing compiler-next analysis, planning and emission
       -> checking representation + TypeScript span mappings
            -> content mapper / CLI / editor
```

Ordinary JS/TS regions need real parser support and preserved ranges. Extended
markup needs a defined grammar and recoverable syntax tree. Avoid one parser for
checking and an unrelated parser for production. Do not use regular-expression
replacement as the general parser for nested code and markup.

Lowering to valid TSX is a candidate for the first experiment. It must preserve
scope, evaluation count, receiver identity and ordering, and compose diagnostics
back to the original file. The shared representation can evolve if this strategy
cannot express a construct faithfully. Runtime output and checking output serve
different purposes and need not have the same generated scaffolding.

## Existing files to reuse

All paths below are relative to the repository root and currently exist.

| Path | Role and boundary |
| --- | --- |
| `packages/compiler-next/src/core/parse/index.ts` | Current JS/TS/JSX/TSX entry; a future source-format adapter must retain authored diagnostics |
| `packages/compiler-next/src/core/parse/lower-typescript.ts` | Existing runtime TypeScript lowering; do not invent a second TS semantics implementation |
| `packages/compiler-next/src/pipeline.ts` | Orders compiler stages; authoring work must not duplicate reactive classification |
| `packages/compiler-next/src/options.ts` | Current public option surface; adding authoring selection here is a later integration choice |
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

## Proposed placement

These paths are **planned**, not existing files or finalized package names.

| Planned path | Responsibility | Owns details |
| --- | --- | --- |
| `packages/jsx-plus/src/parse/` | Extended source tree, authored spans, diagnostics and incomplete-source recovery | [syntax](syntax.md) |
| `packages/jsx-plus/src/lower/` | Runtime-facing lowering and source-map composition | [syntax](syntax.md) |
| `packages/jsx-plus/src/checking/` | Virtual TypeScript and exact authored span mappings | [tooling](tooling.md) |
| `packages/jsx-plus/src/mapper/` | Content mapper transport, configuration and caching | [tooling](tooling.md) |
| `packages/jsx-plus/tests/` | Grammar, mappings and execution comparisons for the prototype | [testing](testing.md) |

Confirm or revise placement during P1/P2 before creating a package. Update this
table with actual files in the same commit that introduces them. One concept
page must own each new implementation file; split [features.md](features.md) when
one of its feature groups starts needing its own files and cases.

## Boundaries

- New syntax reuses existing writes, reactivity, readiness, refs and ownership.
- Existing `.tsx` keeps its normal text and expression-container grammar.
- Source-format selection is explicit; do not guess a language from quote usage.
- The mapper must not run full production DOM compilation on every keystroke.
- Keep TypeScript checking spans separate from runtime/debugging source maps.
- Keep the reference independent of the new production parser/lowerer when
  asserting output; use separately authored equivalents and explicit assertions.
- A prototype does not replace the compiler/Vite public result contract or close
  its SSR, request-isolation, routing and performance acceptance gates.

## Open questions

Which parser entry point can reuse ordinary TypeScript without losing exact
authored spans? Can the smallest lowering preserve scope and child production
without wrapping arbitrary statements into functions? How should maps compose
through existing TypeScript lowering and compiler emission? P2 must answer these
with small examples before broad integration.
