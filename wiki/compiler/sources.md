# Sources and readiness

**Folders:** `features/sources/` _(planned)_; the test reference is built in
`packages/compiler-next/tests/reference/`.

## What it does

Finds values that load over time and makes everything computed from them wait.

## Reference files

All paths below are under `packages/compiler-next/`. This is test code only.

| File | Owns |
| --- | --- |
| `tests/reference/sources.ts` | Independent `$fetch`, `$read`, source state, refresh and readiness values |
| `tests/reference/readiness.ts` | Source imports, guarded expressions, module derivations and payload reads, using yuku |
| `tests/reference/transform.ts` | Component slots, delayed seeds, native destructuring, guarded statements and early returns |
| `tests/reference/runtime.ts` | Waiting effects, `Group` policies and presentation at consuming sites |
| `tests/harness/requests.ts` | Deterministic JSON responses, network failures and request history |
| `tests/cases/sources.test.ts` | Source cases with explicit assertions on the reference and compiled output |

## Rules

- A **source** is a `$fetch` call, a `$read` call, a GET server function call, or a
  call to a helper that returns one. The helper may be in the same module or
  imported; `definition()` from `yuku-analyzer` finds it either way. The old
  compiler missed same-module helpers.
- Server functions that are not GET are actions. They are never sources, because a
  mutation must not run just because a component rendered
  (`../decisions.md`, 2026-10-18).
- **Readiness** (`../rules.md`, rule 8): a node with a non-empty `pending(n)`
  (`core.md`) waits for those sources, everywhere:
  - a derived value is "not ready";
  - a **seed** (state whose initializer reads a source) takes its value when the
    source commits, unless the state was written first;
  - an effect first runs when its sources commit;
  - a source whose request reads another source does not start until that one commits;
  - a render site shows its boundary's pending UI;
  - an early return that reads a source waits too.
- A handler that reads a source before it has loaded gets a compile-time warning,
  not runtime magic.
- Loading and error UI come from the nearest `Group` boundary (`Boundary` in the
  plan). SSR uses the same plan: it waits, or renders the error UI.
- An ordinary `Group` adds no DOM and keeps static content mounted. Each consuming
  site settles independently. `pending` and `error` inherit separately through
  groups and component calls; an empty group passes both through.
- A `suspend` region prepares its active subtree off-screen and publishes together.
  Its refs/effects run only on publication. Inactive branches and unused sources
  do not block publication. This is not yet in the reference.
- Committed content stays visible during refresh and replacement by a pending
  source. New assignments win over older completions; failures still reach the
  error policy. A remounted owner has its own initial presentation.

## Reference implementation

`$when` checks raw inputs before authored code runs. An unavailable computation
returns a `Waiting` value carrying its sources, rather than evaluating against
`undefined` or throwing a suspension signal. `$value` reads the payload in ready
computations. No `try`/`catch`/`finally` is introduced.

A seed keeps a separate "written" flag, so even a user write of `undefined`
prevents a later load from replacing it. Destructuring evaluates the authored
native pattern once per input change and gives each alias its own cell or memo.
Module derivations update before component rendering. Helpers returning a waiting
computation retain its source dependencies.

The reference owns its request state independently of the production data runtime.
Both runs get the same deterministic transport. Current fetch fixtures use JSON;
promise fixtures can resolve or reject. `$track` supports status reads and refresh.
GET client facades are ordinary functions returning `$fetch`; this does not
implement server-definition analysis or RPC generation.

## Inputs and outputs

- In: `Resolved`, linked module summaries (`linking.md`).
- Out: `Source` nodes and their `pending` sets; `Boundary` regions in the plan.

## Where to add things

- A new kind of source: one recognizer in `classify.ts`. Readiness follows from
  the graph and needs no new code.

## Cases to test

`tests/cases/sources.test.ts`: 27 cases, all passing on the reference. The old
compiler passes 18 and fails 9. These failures must pass on `compiler-next`.

Verified on the reference:

- `$read`, `$fetch`, aliased imports, null and undefined payloads;
- derivations through helpers, source destructuring with nested patterns/defaults/
  rest, delayed seeds and writes before a seed is ready;
- effects through derivations, early-return conditions and chained requests;
- module sources/derivations, imported helpers and GET client facades;
- independent sites, inherited policies, errors, retry and refresh status;
- committed content during replacement, latest-assignment wins and remounting;
- matching GET consumers, unused module fetch declarations and lazy top-level
  conditional expressions/derivations.

The old compiler's nine failures cover: writes before plain or destructured seeds
load; effects through derived sources; a same-module source helper; captured
sources through an imported helper; module derivations; status reads while pending;
and inactive source branches in JSX and through a derivation.

## Remaining reference work

The source reference is not complete. Finish these before beginning the compiler;
an unmodeled case is never permitted compiler behavior:

- Atomic `suspend` preparation/publication: child-owned sources, abandoned work,
  refs/effects, errors and retry. The reference explicitly reports `suspend` as
  unsupported instead of silently emitting an HTML attribute.
- Lazy source branches nested inside larger calls/operators, source-dependent body
  loops/unknown calls, whole props-object projections, and module patterns/control
  flow. Current guards can wait too broadly in these forms.
- Imported helpers whose sources are already warm on their first call, plus more
  re-export, closure and alias combinations.
- Full `$track` lifecycle callbacks/cancellation, fetch validation/non-JSON
  transports, complete error details and remaining request API contracts.
- Server-definition/transport fixtures and generated source programs with
  deterministic resolve/reject/refresh/replacement sequences.
