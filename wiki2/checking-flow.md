# Checking flow and replay

State: first paired checking profile built, 2026-11-11. All twenty catalog
targets pass through the actual TypeScript LSP. Complete TOOL-05 acceptance
remains open. This page owns flow checking; [tooling](tooling.md) owns transport
and editor integration.

## Problem and contract

An initial value can narrow more than a later reactive evaluation allows:

```tsx
let value: string | number = 'ready';
return <button onClick={() => value = 1}>value.toUpperCase()</button>;
```

The replayed child needs a member error because the handler can assign a number.
A guard inside that child must still work:

```tsx
return <button onClick={() => value = 1}>
  typeof value === 'string' ? value.toUpperCase() : value.toFixed()
</button>;
```

The original TSX-only projection missed the first error and incorrectly reported
`never` in the guarded number arm. It also missed an unsafe replayed derivation
outside markup and a changing prop read after `await`. These four original
targets now pass without changing their source or expected diagnostic spans.
Execution tests separately demonstrate the guarded child and derivation updating
through compiler-next in both optimization modes.

The contract preserves ordinary synchronous narrowing, guards within an
evaluation, assignment-local callback facts, row scope and shadowing. `let` and
`const` retain compiler-next's existing semantics. Optional refs already pass
the observed cases; this slice does not rebuild refs or add fake ref writes.

## Two checking views

The primary view remains the exact normalized TSX. It owns editor symbols and
checks ordinary host code, declarations and initialization errors. Globally
widening this view would lose valid initial narrowing in synchronous statements.

`checking/flow/plan.ts` uses compiler-owned binding IDs, classifications,
dependencies, computations and escaping-function ranges. Its bounded profile:

- Widens explicitly typed component state initializers to their declared type
  in the supplemental view. Opaque bindings with a captured assignment/update
  are also eligible, covering the catalog's awaited initializer.
- Adds an uninvoked generated writer for block-bodied component props so
  TypeScript does not preserve a changing prop's guard into deferred code.
- Selects dependency-linked JSX expressions, derived initializers/body builders
  and escaping functions for supplemental checking. It does not reclassify
  reactivity or turn lexical write timing into an invocation proof.

`checking/flow/render.ts` creates a complete supplemental TSX module by inserting
checking-only scaffolding. Original expressions stay in their authored function;
there is no new function around `await` or `yield`. State initializers are grouped
before their checking assertion, preserving host operator precedence.

The mapper protocol routes semantic diagnostics by region: the primary view
delegates selected ranges, and the supplemental view ignores their complement.
Ranges are merged before transmission. This uses native TypeScript diagnostics;
there is no diagnostic-code filter, blanket `any` or blanket error suppression.
A regression test verifies that every delegated copied character remains covered
by a nonignored supplemental mapping across the catalog. Real initialization and
member errors also have explicit LSP expectations.

Supplemental copied spans compose back to authored UTF-16 offsets. Their protocol
feature mask is `None`, so they map diagnostics without contributing duplicate
rename/completion edits. Inserted scaffolding has no authored mapping. Actual
LSP tests apply both ref and changing-state renames and recheck the result.
Primary hover/completion flow accuracy is not established by those rename tests.

These changes affect checking only. Production normalization, emitted runtime
code and the language grammar are unchanged.

## Executable catalog and results

Sources and expected authored diagnostic spans live in
`packages/jsx-plus/tests/fixtures/checking-flow.json`.

| ID | Case | Result |
| --- | --- | --- |
| FLOW-TYPE-001 | Unguarded replayed union child | Match: member error |
| FLOW-TYPE-002 | Guarded replayed union child | Match: no error |
| FLOW-TYPE-003 | Replayed derivation outside markup | Match: member error |
| FLOW-TYPE-004 | Changing prop in a deferred continuation | Match: possible-undefined error |
| FLOW-TYPE-005/006 | Optional ref child/handler reads | Match |
| FLOW-TYPE-007/008 | Row-local guard and shadowing | Match |
| FLOW-TYPE-009 | Ordinary synchronous host narrowing | Match |
| FLOW-TYPE-010/011 | Assignment-local guard and real callback error | Match |
| FLOW-TYPE-012/013 | Initial narrowing before/after a replayed derivation | Match |
| FLOW-TYPE-014/015 | Real initialization and replay-region member errors | Match |
| FLOW-TYPE-016 | Inferred readonly derivation | Match |
| FLOW-TYPE-017 | Mutated const discriminated-union object | Match |
| FLOW-TYPE-018/020 | Awaited and yielded state initializers | Match |
| FLOW-TYPE-019 | Fresh prop guard after await | Match |

Run from `packages/jsx-plus`:

```text
bun run tests/probe-flow.ts --strict
```

All twenty targets match, exit zero. Default observation mode prints the same
results without enforcing acceptance. `checking-flow.test.ts` asserts every
catalog target as part of the package suite; none is excluded as a known gap.
The runner always distinguishes this finite catalog from full TOOL-05 acceptance.

## Boundaries and next work

The public [compiler analysis API](../wiki/compiler/analysis.md) serializes existing
frontend facts before planning/emission. Its snapshot IDs, lexical timing and
dependency lists remain limited evidence. The standalone authored adapter in
`checking/facts.ts` exposes exact/enclosing/unmapped locations; the active flow
planner consumes normalized facts directly to avoid a second normalization.

Shifted runtime-TypeScript lowering has no usable map yet. Such inputs, script
inputs without import/export, expected frontend failures and plans without safe
selected regions retain the original checking view with no delegation. Invalid
generated supplemental syntax also falls back. That preserves ordinary checks
but does not promise corrected reactive flow for those unsupported inputs.

Next, expand cross-binding/deferred-call counterexamples and contextual typing
before widening the profile. Complete replay/invocation proofs, module-level
state and live imports, aliases, readiness, row lifecycle, lowering maps and
cross-file editing remain open. Add cache/invalidation evidence and incomplete-
file recovery separately. No general performance or complete editor claim follows
from these twenty cases.
