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
- Only a **replacement** keeps old content: a new request in the same binding
  after one loaded (an input change, a reassignment). A site that starts reading
  a source that never loaded (a branch now chosen) shows the pending policy, not
  what it showed before (`../decisions.md`, 2026-10-19).
- Branches are lazy at any depth: in `'Hi ' + (signedIn ? user.name : 'guest')`
  and `f(a && b)`, only the branch that runs makes the site wait. Statements too:
  `if (useScore) total = user.score` and a `switch` case (with fall-through) wait
  only when they run. Inside a loop nothing is chosen ahead: each iteration can
  choose differently, so the loop waits for everything it reads.
- A source inside an object waits where it is read: `props.user.name` waits for
  `props.user`, the way `user.name` waits for `user`.
- A body statement that passes a value to an unknown call (`collect(names, users)`)
  may build it, so the value waits for that statement's sources until the call has
  run and is seen not to change it.
- A `null` target sends no request and the payload is `null` at once, not pending
  (`docs/05-data.md`: "pauses the request and clears the payload").
- Destructuring a source is valid; the pattern runs when the payload exists
  (`../decisions.md`, 2026-10-19; the docs' `MMD-S004` error is gone). The names are
  derived like any other: they follow a new request, a refresh and a mutation of
  the payload. A name written later is a snapshot; its siblings stay derived.
  `const { name } = $fetch(url)` works like `const user = $fetch(url); const { name } = user`.

## Reference implementation

`$when` checks raw inputs before authored code runs. An unavailable computation
returns a `Waiting` value carrying its sources, rather than evaluating against
`undefined` or throwing a suspension signal. `$value` reads the payload in ready
computations. No `try`/`catch`/`finally` is introduced.

The inputs of an expression are built branch by branch (`inputsOf` in
`readiness.ts`): `$branch` reads a test's inputs, evaluates the test, then lists
the chosen branch's inputs; `$switch` does the same for a `switch`. A test is only
evaluated ahead when it reads nothing declared or written inside the guarded code
(`ReadsOf.evaluable`). Limit: the test is evaluated twice (once there, once
by the authored expression), so a test with side effects runs twice. `$path`
follows `a.b.c` through plain objects and arrays (data properties only, never a
getter) to find a waiting value inside one. `Source.replacesLoaded` marks a
replacement; `$ctx.mayChange` keeps an unknown call's reads as inputs until it is
seen not to change the value. Module derivations and module patterns are
built the same way as a component's (`ModuleMemos`).

A seed keeps a separate "written" flag, so even a user write of `undefined`
prevents a later load from replacing it. Destructuring evaluates the authored
native pattern once per input change and gives each alias its own cell or memo.
Module derivations update before component rendering. Helpers returning a waiting
computation retain its source dependencies.

The reference owns its request state independently of the production data runtime.
Both runs get the same deterministic transport. Current fetch fixtures use JSON;
promise fixtures can resolve or reject. `$track` supports status reads and refresh.
Server function cases import the client module the framework itself generates
from a `define.function` file (`tests/harness/server-functions.ts`, using the
real `analyzeServerFunctionModule` and `generateServerFunctionClient`). A GET
function returns `$fetch(path, { query })`, so it is a source. Any other method
is an action: the reference's `$fetch` starts the request at the call and returns
a promise of the response.

Atomic preparation evaluates component bodies into descriptors and retains their
slots while loading; it creates no DOM and runs no refs or effects. Publication
uses the prepared outputs, connects the whole subtree, installs refs, then runs
effects. Refresh and source replacement keep the committed nodes and content.
Creating or discarding a prepared instance also schedules another reference pass:
its setup/cleanup may change values rendered earlier, while fallback DOM remains
identical. The keyed-draft case caught this reference bug; its assertion was kept.
Failure belongs to the attempted inputs. A failed boundary compares active
descriptors, source identities and child props before reusing its failure. Changed
inputs or an external refresh restart preparation; unrelated renders retain the
failure without replaying child requests. Status changes alone do not replace an
attempt. Recovery cases caught the reference retaining stale errors; their
assertions were also kept.

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

`tests/cases/sources.test.ts`: 69 cases, all passing on the reference. The original
27 give 18 passes and 9 failures on the old compiler; the null-target case fails
it (written on review, it caught the reference treating `null` as a new load);
four destructuring cases give 2 passes and 2 failures (the direct
`= $fetch(url)` case caught the reference destructuring the source object instead
of its payload); five cases of sources inside ordinary JavaScript (body loops,
unknown calls, nested lazy branches, whole sources passed to children, module
patterns) give 1 pass and 4 failures, and caught four reference gaps; five lazy
statement cases (`if`, `switch`, fall-through, a lazy early return, a branch in a
loop) all fail on the old compiler; two server function cases (a GET source
following its arguments, a POST action awaited in a handler) give 1 pass and 1
failure;
the 14 atomic cases give
8 passes and 6 failures; eleven further atomic lifecycle cases give 6 passes and
5 failures. These failures must pass on `compiler-next`.

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
- Source-dependent branches revealing new descendants, keyed draft setup/cleanup
  and stale completions, nested error policies, module ownership across abandonment,
  shared failures with separate policies, removal of a pending branch, and remount
  after failure. Recovery also covers failed external input replacement, removal
  of failed branches, changed child props and external refresh of the same source;
  unrelated renders do not retry. All eleven lifecycle cases have both versions.

**Old compiler failures.** These are the first observed failures in each case;
an early failure can prevent comparison of its later steps. All cases are in
`tests/cases/sources.test.ts`. Rows group cases only where the observed bug matches.

| Case | Expected | Old compiler result |
| --- | --- | --- |
| `a null target pauses the request and clears the payload` | Setting the target to `null` shows `none` with no new request | Shows `loading` |
| `destructuring a fetch call directly follows a changed request input` | `loading`, then `Ada`, then `Grace` after the id changes | Empty text at mount: it destructures before the payload exists |
| `a written destructured name is a snapshot while its sibling stays derived` | `name` keeps `manual` while `role` follows a refresh to `owner` | Throws `UnresolvedDataReadError` (`user` read before it committed) |
| `a write before a source seed is ready wins over the seed` | An early write shows and keeps `manual` | Keeps showing `loading` |
| `an effect waits through a derived source value` | `ADA 1` after resolution | `not run 0`; the effect never runs |
| `a chained request does not start with an unresolved argument` | Wait, request comments, then render its array | Throws `list 'App/when0/comments' requires an array; received object` |
| `a module source and an imported helper preserve readiness` | Wait, then show `ADA` | Rejects the derivation: helper `userName` supposedly writes reactive state |
| `status reads stay available and refresh keeps committed content` | Status shows `pending` immediately | Shows `loading` |
| `an unused source and an inactive branch do not block an active site` | Inactive branch shows `off` | Shows `loading` |
| `a conditional derivation waits only for its chosen branch` | Inactive derivation shows `off` | Shows `loading` |
| `a body loop over a source waits, then follows mutation and refresh` | `loading`, then `3`, `8` after a push, `10` after a refresh | Throws `UnresolvedDataReadError` (`cart` read before it committed) |
| `an unknown helper filling an array from a source waits and replays` | `loading`, then `Ada`, then `Ada,Lin` | Throws `UnresolvedDataReadError` (`users`) |
| `a lazy branch inside a larger expression waits only when chosen` | `Hi guest` and `false` at mount | Both sites show `loading` |
| `a source destructured at module scope waits and is imported` | `loading:loading`, then `Ada:admin` | Rejects with `MMD-S004` |
| `a body if waits only when its branch reading a source runs`; `a body switch waits only for the case that runs`; `a switch case falling through reads the next case too` | The value waits only once the branch reading the source is chosen | Never waits: shows `0`/`here`/`two` and logs `UnresolvedDataReadError` |
| `an early return with a lazy condition waits only when it reads the source` | `no` while signed out | Shows `loading`: waits for `user` though `!signedIn` already decides |
| `a loop decides per iteration, so a branch inside it is not chosen ahead` | `loading` until prices arrive | Shows `0` before the prices load |
| `a POST server function is an action: it runs when called, then a refresh shows its result` | `saved` shows `no`, then `Lin` after the action resolves | `saved` renders empty from mount |
| `a module derivation waits and follows later source refreshes` | Defer `user.name.toUpperCase()` until ready | Throws `undefined is not an object` during module evaluation |
| `a destructured seed written before loading keeps its override` | Delay the seed; preserve its early override | Throws `UnresolvedDataReadError` |
| `suspend ignores unused sources and inactive branches` | Publish `off` immediately | Keeps the entire region on `loading` |
| `suspend waits for a source consumed only by an active effect` | Withhold `child` until that source resolves | Publishes `child` while its effect is still waiting |
| `suspend retries every failed external dependency as one boundary` | Retry both failures and show `loading` | Remains on `right failed`; also reports rejected errors |
| `suspend delays refs and effects until the whole subtree is connected`; `suspend abandons child work and ignores late completions after remount`; `suspend rolls back failed child owners and creates fresh work on retry` | Run each published effect once | Module-counter increments subscribe the effect to itself and reach the render-cycle guard (three failing cases) |
| `suspend lifecycle: replaces a keyed draft and releases its setup exactly once` | Initial setup is visible as `1:0:0:0`, then replacement setup/cleanup are visible exactly once | Initial UI remains `0:0:0:0`; emitted `setups++` has no write notification |
| `suspend lifecycle: a new external source replaces failed preparation without remounting` | Replacing the source leaves the old failure and shows `loading`, then `Ada` | Keeps showing `offline` after replacement |
| `suspend lifecycle: removing a failed branch publishes the remaining active content` | Removing the failed branch publishes `Staticoff` | Keeps showing `offline` |
| `suspend lifecycle: changed child inputs replace failed work while unrelated renders do not retry` | A new child `id` starts `/user/2`; an unrelated counter change starts no request | Changing `id` leaves only `/user/1` in the request history |
| `suspend lifecycle: external refresh recovers the same failed source passed to a child` | Refresh leaves the failure and shows `loading`, then `Ada` | Keeps showing `offline` after refresh |

The first 25 atomic cases have both generated `reference/` and `compiled/` outputs
under `tests/out/<case>/`. An old compile rejection leaves no compiled module;
runtime and assertion failures retain the emitted code for inspection.

## Remaining reference work

The source reference is not complete. Finish these before beginning the compiler;
an unmodeled case is never permitted compiler behavior:

- Further atomic lifecycle combinations: captured state changes inside failed
  children without changed props, and more interleavings of shared owners and
  source generations. The verified 25 cases
  do not exhaust these combinations.
- Module-scope control flow (`let x = 0; if (flag) x = user.y` at module scope)
  and module patterns with a name written later are not modeled.
- Computed paths (`props[key].name`) and sources inside class instances or
  Maps: `$path` follows static names through plain data only.
- Imported helpers whose sources are already warm on their first call, plus more
  re-export, closure and alias combinations.
- Full `$track` lifecycle callbacks/cancellation, fetch validation/non-JSON
  transports, complete error details and remaining request API contracts.
- Open question for the user: a non-GET server function called in a component
  body (`const saved = createUser(input)`). It is not a source, but as a body
  call it runs on mount and again when its arguments change. Not tested until
  decided. Live/generator/`page()` server functions are not modeled.
