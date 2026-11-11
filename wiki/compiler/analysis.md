# Read-only compiler analysis

State: initial public snapshot API, 2026-11-11.
**Folder:** `analysis/` (`packages/compiler-next/src/analysis/`).

`@memoized-dom/compiler-next/analysis` exports `inspectModules()` for ordinary
JS/TS/JSX/TSX inputs. It uses the same parse, resolve and graph stages as production,
stopping before render planning, optimization and emission. Extended syntax and
editor mapping remain in the separate JSX+ package.

| File | Responsibility |
| --- | --- |
| `index.ts` | Public inspection function, type exports and existing CompileError export |
| `model.ts` | Readonly serialized snapshot contract |
| `frontend.ts` | Shared parse → resolve → graph ordering |
| `serialize.ts` | Copy existing graph facts into detached records |
| `analysis.test.ts` | Classification, scope, coordinates and provenance tests |

The production pipeline calls `analysis/frontend.ts` for its unchanged frontend
sequence, then continues with the existing remaining stages. Inspection imports
the frontend directly. Frontend utilities may share helpers with optimization;
inspection never runs an optimizer or DOM emitter. There is no persistent cache.

The dedicated entry also exports the existing `CompileError` class, allowing
checking consumers to distinguish expected frontend failures without importing
the production facade. Unexpected internal failures must not be swallowed.

## Snapshot contract

Version 1 returns exact input/analyzed text and primitive records. Binding IDs
are local to one inspection snapshot; they distinguish shadowed names and connect
imports to definitions. Do not reuse them after an edit without a new snapshot.

Bindings retain existing kinds, declaration extents, owners, references, writes,
input links and initial computations. Builders retain source order, certainty,
invocation and readiness flags. JSX expressions and escaping functions carry
existing input facts; receiver use is explicit. Expression facts include both
ordinary expression-container values and JSX spread-attribute arguments, queried
through the same existing input analysis. No analyzer object or AST escapes.

Unresolved/global inputs retain module, range and compiler reactivity. An empty
named-dependency list does not establish an input-free computation. Likewise,
`opaque: false` does not prove a complete runtime read set. Binding-level links
retain live imports even without a local initializer.

Write timing is lexical: a nested callback may execute immediately. A classified
computation also does not prove every use replays. Consumers must preserve these
limits rather than invent execution guarantees from a binding kind alone.

## Coordinates and verification

Ranges use UTF-16 offsets in `analysisSource`. Declaration extents may include
annotations; they are not automatically identifier rename ranges. `input-prefix`
means analyzed text starts with exact input. Only ranges inside that prefix keep
input coordinates; appended ambient imports are generated. `lowered` indicates
rewritten input. Without lowering maps those offsets cannot be used as authored.

The JSX+ adapter distinguishes exact, enclosing and unmapped ranges, and refuses
shifted lowering coordinates. See [the prototype map](../../wiki2/architecture.md).

Tests cover classifications, row shadowing, enums, globals, live imports, builders
and unchanged output around inspection. Spread tests pin the argument's range and
binding identity. JSX+ consumes these facts for its hardened paired checking
profile, clearing 34 targets including receiving-component errors. Complete
replay proofs, incremental invalidation and cross-file editing remain open on
[checking flow](../../wiki2/checking-flow.md).
