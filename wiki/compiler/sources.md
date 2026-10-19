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
| `tests/reference/preparation.ts` | Walks the active subtree without DOM, collecting waiting consumers and prepared component output |
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
- A `suspend` region prepares its active subtree off-screen and publishes together on initial mount.
  Its refs/effects run only on publication. Inactive branches and unused sources
  do not block publication. Child-owned sources and sources consumed by active
  effects participate; unused component props do not. Nested fallbacks are withheld
  under the outer atomic boundary's policy.
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

Atomic preparation evaluates component bodies into descriptors and retains their
slots while loading; it creates no DOM and runs no refs or effects. Publication
uses the prepared outputs, connects the whole subtree, installs refs, then runs
effects. Refresh and source replacement keep the committed nodes and content.

Component instances claim their sources. Abandoning a draft releases its owners,
aborts unshared fetch work and ignores late completions. A remaining GET consumer
keeps its shared source alive. A failed draft is released without mounting;
retry refreshes failed external sources and recreates child-owned work. Explicit
request cancellation through `$track` is still separate, unfinished work.

## Inputs and outputs

- In: `Resolved`, linked module summaries (`linking.md`).
- Out: `Source` nodes and their `pending` sets; `Boundary` regions in the plan.

## Where to add things

- A new kind of source: one recognizer in `classify.ts`. Readiness follows from
  the graph and needs no new code.

## Cases to test

`tests/cases/sources.test.ts`: 41 cases, all passing on the reference. The original
27 give 18 passes and 9 failures on the old compiler; the 14 atomic cases give
8 passes and 6 failures. These failures must pass on `compiler-next`.

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
- Atomic Group/component/element activation, child-owned requests, withheld static
  siblings and nested fallbacks, connected refs before effects, effect-only source
  consumers, abandonment/remount and stale completions, shared GET ownership,
  failures/retry, and committed DOM identity during refresh/replacement.

The old compiler's nine failures cover: writes before plain or destructured seeds
load; effects through derived sources; a same-module source helper; captured
sources through an imported helper; module derivations; status reads while pending;
and inactive source branches in JSX and through a derivation.

The atomic comparison adds six failing cases: inactive source branches block
publication; a source consumed only by an effect does not withhold publication;
multiple failed external dependencies do not all retry; and three lifecycle cases
loop effects that increment module counters (publication, remount, and retry).
The latter share an existing effect-subscription bug, rather than being three
distinct new bugs. All 14 cases have both generated `reference/` and `compiled/`
outputs under `tests/out/<case>/`.

## Remaining reference work

The source reference is not complete. Finish these before beginning the compiler;
an unmodeled case is never permitted compiler behavior:

- Extend atomic cases with source-dependent branches that reveal new descendants,
  keyed draft replacement/cleanup, nested error policies and module-owned sources
  across abandonment. The first 14 cases cover initial preparation/publication;
  they do not exhaust atomic lifecycle combinations.
- Lazy source branches nested inside larger calls/operators, source-dependent body
  loops/unknown calls, whole props-object projections, and module patterns/control
  flow. Current guards can wait too broadly in these forms.
- Imported helpers whose sources are already warm on their first call, plus more
  re-export, closure and alias combinations.
- Full `$track` lifecycle callbacks/cancellation, fetch validation/non-JSON
  transports, complete error details and remaining request API contracts.
- Server-definition/transport fixtures and generated source programs with
  deterministic resolve/reject/refresh/replacement sequences.
