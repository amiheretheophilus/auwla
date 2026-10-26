# Handlers, writes and mutation

**Folder:** `features/handlers/` (component-local assignment/update planning and emission built).

## What it does

Finds every place that changes state and makes the UI update after it.

## Files and current slice

| File | What it does |
| --- | --- |
| `plan.ts` | Groups graph write sites by native assignment/update/loop operation and binding identity; identifies readonly targets |
| `dom.ts` | Preserves native operations and their results, bumps local versions, marks pending commits and preserves const errors |
| `dom.test.ts` | Executes compiled modules to verify write semantics, scope, per-instance state and site replay |
| `mutations.ts` | Emits direct member-store targets and delete notifications; replay uses silent versions |
| `mutations.test.ts` | Native computed-key order, receiver/logical semantics, partial patterns and member loop targets |
| `receivers.ts` | Plans and emits this/private/super store targets with lexical class access |
| `core/emit/await.ts` | Preserves native await expressions while flushing writes after operand evaluation and scheduling resumed observation recovery |
| `await.test.ts` | Native immediate-suspension checks, return await, operands/receivers, awaited call arguments and suspended factory ownership |
| `packages/runtime/src/mutation.ts` | Member target preserving native key conversion, getter/setter receiver and successful-store notification |
| `packages/runtime/tests/mutation.test.ts` | Descriptor snapshots, cyclic/native data, partial-call recovery and key order |
| `packages/runtime/tests/mutation-roots.test.ts` | Index membership cleanup on disposal/replacement, retained live aliases, opaque edits, interrupted rebuilds and disposal during reflection |
| `packages/runtime/src/method-calls.ts` | `observeMethod`: skips the snapshot for a call whose actual callee is a proven array intrinsic (`optimize.md`, "Method calls") |
| `packages/runtime/tests/method-calls.test.ts` | Proven calls take no snapshot; own/replaced methods, subclass species, converting arguments, effectful callbacks and throws stay observed |
| `optimize/methods.ts` | Lowers observed member calls to `observeMethod` and marks effect-free inline callbacks |
| `optimize/methods.dom.test.ts` | Callback classification and native updates, overrides and order, with optimizations on and off |
| `tests/cases/handlers.test.ts` | Reference comparisons for handlers, async writes, helper callbacks, accessors and index/property-key conversions whose edits must reach the UI |
| `packages/runtime/src/write-batch.ts` | Captures the application and entity, publishes groups of pending writes, and shares recovery scheduling across unfinished batches |
| `packages/runtime/tests/write-batch.test.ts` | Scheduler independence, nested listeners, native receivers/results, exceptions, disposal and application isolation |
| `packages/runtime/tests/write-batch-recovery.test.ts` | Commit/callback counts, parent-child overlap, later writes, explicit renders, cross-application order and recovery failures |
| `packages/runtime/tests/retention.test.ts` | Completed batch, observation and notification payload release, bounded recovery scheduling, and guaranteed recovery of abandoned calls |

The outer listener and pre-await boundary drain newly dirtied batches as well as
the initial set. A parent commit can deliver props that dirty a child; that child
settles before the same listener returns. A focused runtime regression and the
native SVG component update check cover this propagation.

Each contiguous group of batches from the same application enters one kernel
commit. First-mark order is retained across interleaved applications; the kernel
orders parents before children within a group. A weak per-application entity
index connects batches to the kernel's generic `onEntityRender` hook. A write is
acknowledged when its entity starts rendering, including explicit entity and
descendant renders. A parent marking an already queued child therefore does not
cause a duplicate update, while a later sibling writing an already rendered child
still schedules another update. Entity and render callback objects are unchanged.

Unfinished batches share one recovery callback that captures no row. Completed
batches leave its pending set immediately. Recovery reserves a continuation before
entering opaque observation or rendering, so a failure cannot strand remaining
rows or applications. Only the first batch is consumed before observation;
remaining batches stay recoverable if observation itself throws. Helpers live on
the batch prototype, while public methods remain bound for use as callbacks.

The native 200-row check renders every row with one kernel commit and one queued
recovery after a successful listener (previously 200 commits and 201 callbacks).
The retention check holds that callback without running it and verifies completed
row data can be collected. Both compiler modes also check a constant callback
budget during the authored fixture's 100-row edit. These work and liveness checks
do not establish a timing improvement or resolve the reported VM OOM.

The subsequent same-compiler ABBA runner check shows faster component-row updates
in both orders, with mixed clearing and inline-row results (`optimize.md`,
"Implementation order after Phase 6"). The full shared-code audit passes all
95 runtime tests and 248 compiler unit/native tests; comparison cases retain only
the existing 100 Phase 7/8 failures (`../status.md`).

Simple assignments and updates call a generated helper **after** the native
operation succeeds; the helper returns that operation's value. Logical assignment
uses its native short-circuit condition, so a skipped assignment does not bump a
version. Destructuring uses private setter targets at the original target's lexical
scope, while JavaScript still evaluates the pattern, defaults, rest and result.
Each completed target reports separately: a later throwing getter cannot hide an
earlier write. Loop targets report each completed assignment.

Const targets use generated accessors: compound updates read and coerce the
current value, and the setter checks the binding's temporal dead zone before
calling runtime `rejectConstAssignment`. The runtime throws TypeError, unaffected
by an authored binding named `TypeError`. This preserves authored write errors
when a derived const uses writable compiler storage, and avoids bundlers rejecting
the generated program for a direct assignment to a const. The same write emitter
supports silent version bumps for direct memo replay; callbacks created there
keep their normal commit helpers.

Writable memo targets with takeover candidates use the derived feature's store
accessors instead of a second write wrapper. Native JavaScript still evaluates
assignments, updates, loops and patterns; each successful target store decides
whether to mark takeover and notify. Writes during that owner's setup/replay build
the value without taking over, and taken targets ignore replay stores while sibling
targets remain active (`state-and-derived.md`).

Native listeners preserve their receiver, arguments and return value. Their outer
return flushes pending writes, even with an immediate test scheduler; nested
listeners do not flush an intermediate value. Listener depth is shared across
batches: an event that changes shared state flushes every pending consumer at its
outer return, including consumers in another application. Per-batch depth still
controls that batch's direct flush. The cross-application nested-listener runtime
test verifies neither consumer renders early and both render once on return. Timers and
promise callbacks use the queued microtask boundary. Setup writes seed values;
`beginMount` then records render-time invalidations without scheduling unfinished
sites. `activate` settles remembered changes after every site is ready.
Notifications retain the originating application
and entity identity, so a delayed callback cannot update a replacement instance.
Error recovery resets the listener depth at the next microtask without adding
`try`/`catch`/`finally` around authored code.

Direct property assignment/update/delete now bumps the root binding's version.
Native member targets notify each successful pattern/loop store independently;
computed keys convert once before the RHS. A mutation never takes over the root
binding or makes a const assignment illegal. Definite property builders replay
silently with their inputs. Three comparison cases in `cases/mutations.test.ts`
verify derived readers, retained edits and body replay. Opaque receiver/argument
calls now observe data before and after the native call. Descriptor snapshots
avoid unused getters and include cycles, symbols, hidden fields, Map/Set, Date
and binary data. A throwing call is completed at an authored catch boundary or
the next microtask. Calls retain their native result and receiver.

Component roots are watched by object identity through data fields; changed
objects notify aliases and shallow copies that actually share them. Disposal
removes those roots. Classification keeps potential source roots reactive, while
runtime identity decides which versions change. A read is a potential root only
when its value can become part of the mutated binding: an operand of arithmetic,
a comparison, `typeof`, template text or a conditional's test produces a new
primitive, so `const local = value * LIMIT` leaves `LIMIT` constant
(`features/state/classify.ts`, `mayFlowIntoValue`). Seven mutation comparisons pass.

Finding the roots that share an edited object must not cost the size of all
mounted data on every write. `runtime/src/mutation.ts` keeps, per root, the set of
objects it reached when it was last walked. A compiled store adds what it wrote.
A store that may drop an object marks the set stale, and so do a delete and a
receiver write. A root that now holds another value is walked again. An opaque
call or an uncompiled setter forgets the set of each root it touched. So a miss
is exact. A hit on a stale set walks that root again before notifying, so a
removed object never notifies its old root.

An edit of a root's own value is a hit even when its set is stale, so only a hit
on an object the root may have dropped walks it again. A proven array method edit
(`observeReceiverEdit`) records the objects it may add, its arguments, and marks
the set stale, instead of forgetting it. Dense shared data roots can reuse that
reach across consecutive structural edits. Component roots release stale index
memberships after a completed update, as described below.
Receiver edits record the exact insertion argument interval. Reaches with
accessors or array holes are forgotten instead: native calls can materialize
values that their data descriptors did not contain. The next lookup discovers
those new aliases without invoking unused getters (`optimize.md`, "Method calls").

Component roots are also indexed by the objects they reach. A component can mount
one per instance, so 10k rows would mean 10k roots. A store looks up only the
roots holding the edited object, rather than visiting every mounted component:
update 10k spent 3 s in that loop (1,000 stores × 10k entities). The index may
keep extras, which the reach check rejects. A new root, or one after an unknown
edit, is walked before the next lookup.

A root whose binding was reassigned has already marked its own component, so the
emitted `_update` re-checks that component's roots (`checkMutationRoots`).
Each indexed root records the buckets it joined. Disposal detaches those
memberships and clears its cached reach, so long-lived data does not accumulate
dead root records. Rebuilding a root first detaches its previous graph; an
interrupted rebuild stays pending for the next lookup. Completed component
updates also detach changed or stale graphs before their lazy rebuild. Opaque
edits can forget the reach before that update, and still release its old buckets.
Reflection that disposes an owner cannot reattach its dead root.
The 200-cycle mount/dispose regression leaves zero memberships (previously 200),
and the remaining native checks verify that current aliases still notify.
Reading every root on every store is not needed. Components with no roots
register none. Module and factory roots are few, one per shared binding, and are
still checked on every edit. A typical write (`row.label = x`) costs one index
lookup and one check per holding root.
Known limit: uncompiled code that adds an object to watched data outside an
observed call is not seen until that root is walked again.
Shared writes also check the identities of already cached native bindings and
release a reach whose value was replaced. Shared derivation refresh calls the
same check after replay, since it can replace a value after its input write
published. These checks read native storage, without walking data or invoking
unused accessors. Native GC checks cover reassignment without a later mutation;
compiled checks cover collection after a lazy refresh in both modes.

An opaque call takes one shallow snapshot of each object its reads reach, before
and after. A read is notified when one of its objects changed or the read now
gives another value. This answers the same question as a deep snapshot of each
read, without taking two more.
Completed observations immediately clear their read/notification closures,
values, reach sets and snapshots, including when a caller retains the completed
handle. Successful calls do not leave those payloads alive until recovery runs.
Mutation recovery queues once per application turn, using that application's
runtime. An abandoned call stays strongly reachable until its first recovery;
after that it uses a weak reference while a native awaiting caller retains its
own handle. Notification-wave recovery also queues once per turn and does not
capture completed subscriber sets. The retention tests hold recovery callbacks
without running them, cross task boundaries, force collection with bounded
retries, and check weak-reference liveness; they do not infer leaks from timings
or a heap-size threshold.
The notification-wave fixture creates its payload in a separate task, keeping
possible dead temporaries off its awaiting test frame. Its collection assertion
still runs before the held recovery callbacks, so they cannot hide retention.
Receiver writes through `this`, private fields and `super` now report changes to
their receiver's roots. Module/factory versions and shared roots notify subscribed
consumers (`state-and-derived.md`). A shared binding's watched root and its edits
use one notifier function (`shared-dom.ts`, `_mutated_x`). An edit made through
that binding (`data[i].label = …`) has already notified it, so `notifyAliases`
does not walk that root when it has no current reach: after `data = buildData()`
the first edit no longer reflects over all 10k items. The root is walked when an
edit through another binding needs it, as any unwalked root is. A component's
roots name their binding's edit notifier as `direct` (`core/emit/dom.ts`), so the
same holds for component state: an edit through `data` neither walks `data`'s
root eagerly nor notifies it twice. Proxy-specific reflection behavior still needs
coverage.

The snapshot costs the size of the data the reads reach: about 70 ms per call on
10k rows, even for `items.slice(1)`. With optimizations on, a plain member call
lowers to `observeMethod`, which skips it when the runtime proves the actual
callee (`optimize.md`, "Method calls"). An edit it proves touches only a receiver
that every read returns; it is reported through `observeReceiverEdit`, which keeps
a pending entry so a throw mid-call is still recovered.

Shared mutation notifications carry the exact written binding key. Hidden-read
collectors exclude that computation's own outputs, while other shared inputs
remain subscribed (`state-and-derived.md`). Call wrappers composed at module and
component scope preserve callback instrumentation through authored copy origins
(`core.md`).

Before each native `await`, the operand evaluates once and pending write batches
flush even inside nested listeners. The same value then reaches native await;
resumption schedules observation recovery for calls whose arguments suspended.
Observations retain updated baselines across recovery rather than becoming
permanently closed before the actual call. Abandoned observations use weak
references after their guaranteed recovery microtask. Shared async owners leave
their setup scope when suspending, so their caller can continue building.

The Phase 3 gate passes under the agreed view scope. A native regression covers
Object.setPrototypeOf, Object.defineProperty and Reflect.deleteProperty without
invoking an unused getter. **Known conformance gap:** snapshots and alias scans
still invoke proxy reflection traps; hostile/revoked proxies and WeakMap-backed
state need further coverage and fixes. These are not accepted failure semantics.
Nested-block storage, shared storage and explicit await boundaries are built.

## Rules

- A later callback's actual binding reassignment ends that binding's derivation;
  registering the callback does not. The rule is uniform for known and unknown
  callers, with no callback API name list (`state-and-derived.md`, "Callbacks").

- **Any function that writes a reactive binding is a handler**: an event callback,
  an effect body, a callback ref, a helper called from them, a `setTimeout`
  callback. `capturesOf(fn)` lists the outer bindings it reassigns. Mutation sites
  come from `core/resolve/`.
- **Any expression is a valid handler**: an arrow, a function name, a member
  (`onClick={actions.go}`) or a call result (`onClick={make()}`, evaluated at
  render). The old compiler rejected the last two.
- **Every method call on state is a possible mutation**, so the state's readers
  update after it. `optimize/methods.ts` _(planned)_ may say a call does not
  mutate (`items.map`, `items.slice`), which skips that update. A method not on
  that list keeps the general path. It is never rejected.
- Passing state to a function the compiler cannot see is also a possible mutation.
- **The UI shows what the console would show.** Writes in one synchronous stretch
  are batched. The UI updates when that stretch ends:
  - when the handler returns;
  - before each `await`, because the handler pauses there;
  - at the end of each `.then`, `setTimeout` or listener callback.

  The user: "it needs to follow how it will appear in the console".

  ```js
  async function run() {
    step = 'uploading';
    await upload();      // UI: uploading
    step = 'processing';
    await process();     // UI: processing  (the old compiler skips this one)
    step = 'done';       // UI: done
  }
  ```
- Each `writes` edge gets a reason id. A site updates only for reasons on its paths.
  This is an optimization (`optimize/reason-routing.ts` _(planned)_); without it the
  general path updates every reader of the binding.

## Inputs and outputs

- In: `Resolved` (reassignment and mutation sites, captures).
- Out: `Handler` nodes and `writes` edges; `EventSite`s in the plan.

## Where to add things

- A new way code can change state (a new syntax form): `core/resolve/` mutation
  sites. Handlers pick it up without changes here.

## Cases to test

In `packages/compiler-next/tests/cases/handlers.test.ts`.
The local assignment slice also has nine `tests/cases/counters.test.ts` comparison
cases, all passing: independent counters, helper batching, expression results,
logical assignments, patterns, loop targets, timers, live properties/attributes/
handler selection, and repeated attributes. Seven direct execution tests cover
unrelated/no-op writes, typed text, instance isolation, shadows, partial throwing
patterns, defaults/rest and block scope. Eight runtime batching tests pass.
Existing `typing into an input` and `an async helper preserves return await` pass
on compiler-next; the full handlers file is not yet a Phase 3 exit pass.
Callback takeover cases are in `tests/cases/callbacks.test.ts`; their expected and
old-compiler results are on `state-and-derived.md`, "Callback verification".

The old compiler fails these:

- `onClick={actions.go}` and `onClick={make()}`: rejected.
- A write between two `await`s: it shows `uploading` until the end, never
  `processing`.

These pass today: reassigning module state from a handler; typing into an input.

The reference also asserts an async helper using `return await defer(...)`.
Readiness guards must preserve its async body rather than move the `await` into a
synchronous thunk.

Old messages not yet checked against valid code:
  - "handler assigns X which is neither module state nor a handler local";
  - "module-state write cannot produce a value" (server builds).
