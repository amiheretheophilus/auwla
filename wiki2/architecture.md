# Architecture and code map

State: compiler-next extension; new syntax implementation not started.
Updated: 2026-11-10. Existing compiler/runtime features, including refs, are built.
Owns DX-28 and the integration side of DX-03.

## One production compilation path

JSX+ adds authoring features beyond ordinary JSX to compiler-next. Extend the
existing parse stage so the new syntax reaches the same compiler representation
and later stages. There is no standalone JSX+ production compiler, second
reactivity model, or separate DOM/SSR emitter. Existing refs are reused as built.

```text
existing JS/TS/JSX/TSX input   additional JSX+ syntax
             \                 /
         compiler-next parse stage
         (extend syntax support here)
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

Normalizing extended syntax into compiler-next's existing input representation
is the frontend task. Lowering to valid TSX within that parse stage is a candidate
for the first experiment. It must preserve scope, evaluation count, receiver
identity and ordering, and compose diagnostics
back to the original file. The shared representation can evolve if this strategy
cannot express a construct faithfully. The compiler continues from that point
through its existing analysis and emission. The TypeScript checking projection
serves editor/type-checking needs and need not have application-output scaffolding.

## Existing files to reuse

All paths below are relative to the repository root and currently exist.

| Path | Role and boundary |
| --- | --- |
| `packages/compiler-next/src/core/parse/index.ts` | Existing parse entry to extend for additional syntax; retain authored diagnostics and the normal compiler pipeline |
| `packages/compiler-next/src/core/parse/lower-typescript.ts` | Existing runtime TypeScript lowering; do not invent a second TS semantics implementation |
| `packages/compiler-next/src/pipeline.ts` | The production pipeline for both existing syntax and JSX+; no alternative stage sequence |
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

These paths are **planned**, not existing files. Syntax support belongs inside
compiler-next; mapper transport/checking code is tooling. Exact filenames can
change during the experiment without changing this production-path decision.

| Planned path | Responsibility | Owns details |
| --- | --- | --- |
| `packages/compiler-next/src/core/parse/jsx-plus/` | Extended syntax, authored spans, recovery and normalization into the existing compiler input | [syntax](syntax.md) |
| `packages/compiler-next/tests/authoring/` | New-syntax fixtures and comparisons using the same compiler-next entry/pipeline | [testing](testing.md) |
| `packages/language-service/src/content-mapper/checking/` | Virtual TypeScript and authored spans; tooling projection only | [tooling](tooling.md) |
| `packages/language-service/src/content-mapper/` | Mapper transport/configuration/cache; packaging remains open | [tooling](tooling.md) |

Confirm or revise exact placement during P1/P2 before adding directories. Update this
table with actual files in the same commit that introduces them. One concept
page must own each new implementation file; split [features.md](features.md) when
one of its feature groups starts needing its own files and cases.

## Boundaries

- New syntax reuses existing writes, reactivity, readiness, refs and ownership.
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

How should the existing parse entry reuse ordinary TypeScript without losing
exact authored spans? Can the smallest normalization preserve scope and child production
without wrapping arbitrary statements into functions? How should maps compose
through existing TypeScript lowering and compiler emission? P2 must answer these
with small examples before broad integration.
