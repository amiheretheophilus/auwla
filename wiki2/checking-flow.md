# Checking flow and replay

State: TOOL-05 investigation and executable target catalog, 2026-11-11.
The current checking projection has four confirmed gaps. No flow fix is claimed.
This page owns checking-flow examples, proposed input facts and the next slice;
the [tooling page](tooling.md) owns transport and editor integration.

## Problem

The same source can be evaluated initially and replayed after a later write.
TypeScript checks normalized TSX as ordinary one-time JavaScript. Its initial
narrowing can therefore be too narrow for a replayed read:

```tsx
let value: string | number = 'ready';
return <button onClick={() => value = 1}>value.toUpperCase()</button>;
```

The current projection reports no error. A replay after the handler write needs
to handle the number alternative. Conversely, guarding that same child should
be valid:

```tsx
return <button onClick={() => value = 1}>
  typeof value === 'string' ? value.toUpperCase() : value.toFixed()
</button>;
```

The current projection incorrectly reports the number arm as `never`. The package
execution tests demonstrate this exact guarded fixture changing from `READY` to
`1` through compiler-next, in both compiler modes.

## Target checking contracts

These targets describe checking evidence, not a change to JavaScript execution
or a decision that `let` alone makes a value reactive.

- A replayed read must admit the binding's values reachable on later executions.
  Initial narrowing alone cannot justify a member access on every replay.
- A guard evaluated during the same replay must narrow its selected arm normally.
- Derived initializers outside markup can replay too. Their location outside
  JSX does not make initial narrowing valid forever. `const` and `let` retain
  compiler-next's existing rules.
- A guard before registering a deferred callback does not prove a changing prop
  remains present after an `await`. The continuation needs its own valid guard
  or an authored snapshot when that is the intention.
- Row-local parameters, shadowed bindings and assignment-local callback guards
  keep their own identities and scopes. Equal identifier spelling is insufficient.
- Ordinary synchronous host code keeps normal TypeScript narrowing. This also
  matters to the planned nonreactive backend authoring path; its config is not
  implemented by this probe.
- Optional refs already check correctly in the observed child/handler examples.
  This evidence does not justify adding fake ref assignments or suppressing
  genuine member/absence errors.

## Executable catalog and results

The actual source/expected authored diagnostic spans live in
`packages/jsx-plus/tests/fixtures/checking-flow.json`. Expected entries describe
the target result, not the current faulty output. UTF-16 offsets are calculated
from each full authored source; host diagnostics remain TypeScript diagnostics.

| ID | Case | Current result |
| --- | --- | --- |
| FLOW-TYPE-001 | Unguarded replayed union child | Gap: missing member error |
| FLOW-TYPE-002 | Guarded replayed union child | Gap: false `never` member error |
| FLOW-TYPE-003 | Replayed derivation initializer outside markup | Gap: missing member error |
| FLOW-TYPE-004 | Changing prop read in a deferred continuation | Gap: missing possible-undefined error |
| FLOW-TYPE-005/006 | Optional ref child/handler reads | Match |
| FLOW-TYPE-007 | Row-local union guard | Match |
| FLOW-TYPE-008 | Row parameter shadows a changing outer binding | Match |
| FLOW-TYPE-009 | Ordinary synchronous host narrowing | Match |
| FLOW-TYPE-010 | Assignment-local callback narrowing | Match |
| FLOW-TYPE-011 | Genuine callback member error | Match |

Run from `packages/jsx-plus`:

```text
bun run tests/probe-flow.ts
bun run tests/probe-flow.ts --strict
```

Both run the actual pinned TypeScript LSP and mapper, reporting expected and
observed spans. Observation mode is an investigation command. Strict mode exits
one while any catalog target is unmet; **it currently fails on 001–004**.
The tool never claims full TOOL-05 acceptance even if this small catalog matches.

`tests/checking-flow.test.ts` runs the same catalog and asserts the seven existing
baseline cases; it explicitly reports remaining gaps. It does not assert that
the four bugs are correct. The `coverage` field selects this regression bucket,
not a different semantic contract. Promote a gap to baseline after its target
passes, keeping the full strict catalog as a separate gate.

## Why the projection is unchanged

A non-immediate checking-only thunk repairs the first two isolated examples in
an experiment. It leaves the derivation outside JSX and deferred reactive-prop
case unresolved, and a blanket function boundary changes valid `await`/`yield`
contexts. Global declaration widening also loses legitimate synchronous facts.
These are rejected experiments, not new authored syntax or runtime transforms.

The checking projection needs a description of replay sites and the bindings
they read. The existing public compiler API does not expose those lightweight
facts. Calling full DOM compilation on every edit would contradict the mapper
boundary. Importing compiler internals or inventing a second reactivity classifier
would also break the current package contract.

## Next implementation slice

Define a small source-aware fact boundary before implementing a flow projection.
The required information is:

| Fact | Why it is needed |
| --- | --- |
| Authored binding identity and reference ranges | Keep parameters, locals and shadowed names distinct |
| Replay regions, including derived initializers | Discard transient initial facts only at actual later evaluations |
| Deferred continuation boundaries and possible updates | Avoid carrying a mount-time prop guard across later execution |
| Local guard/assignment scope within each evaluation | Preserve ordinary narrowing where it remains valid |
| Provenance from the existing compiler semantics | Keep checking aligned with reactivity without reimplementing it |

The placement and public shape of these facts are a design task, not an API
already available in this package. They must be obtainable without production
DOM emission and mapped back to authored locations. Keep compiler-next/runtime
implementation unchanged in this investigation slice.

Once that boundary is concrete, implement the smallest faithful checking
projection and rerun all eleven targets, actual rename/edit checks, and the
runtime guard cases. Added scaffolding must stay unmapped; no blanket `any`,
diagnostic suppression or invented authored declarations. Broader aliasing,
readiness, row updates and callback lifecycle remain additional acceptance work.
