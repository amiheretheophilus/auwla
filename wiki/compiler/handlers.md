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
| `packages/runtime/src/write-batch.ts` | Captures the application and entity, batches listener writes until return, and queues a microtask for unwrapped callbacks and error recovery |
| `packages/runtime/tests/write-batch.test.ts` | Scheduler independence, nested listeners, native receivers/results, exceptions, disposal and application isolation |

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
listeners on the same component do not flush an intermediate value. Timers and
promise callbacks use the queued microtask boundary. Setup writes do not schedule
DOM work before registration. Notifications retain the originating application
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
runtime identity decides which versions change. Seven mutation comparisons pass.
Receiver writes through `this`, private fields and `super` now report changes to
their receiver's roots. Module/factory versions and shared roots notify subscribed
consumers (`state-and-derived.md`). Proxy-specific reflection behavior still needs
coverage; no method fast paths exist yet.

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

**Still pending in Phase 3:** the exit audit, nested-block memo storage and
remaining reflection coverage. Shared storage and explicit await boundaries are
built; the full Phase 3 exit is not yet claimed.

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
