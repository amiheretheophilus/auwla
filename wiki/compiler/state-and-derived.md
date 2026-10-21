# Props, state and derived values

**Folders:** `features/props/`, `features/state/`, `features/derived/` (graph
classification built in Phase 2; component-local assignment versions built in
Phase 3; local versioned memos and definite body replay built).

`features/state/plan.ts` selects component-owned bindings with assignment/update
sites from the graph. `features/state/dom.ts` allocates a local numeric version per
binding; values stay native JavaScript variables. `core/emit/sites.ts` saves the
versions a site read and reevaluates only when one changes, preserving unchanged
DOM properties such as typed input text. Unknown calls with no known changed
input are not replayed merely because another value was written.

`features/derived/plan.ts` plans top-level component declarations, including native
destructuring, and their definite body builders. Computations sharing a statement
form one group: all its outputs reset together and the statement replays once.
Initializers and builders retain their original order, even when another memo
appears between them. Plans retain direct inputs and upstream memo edges. Before
replay, dirty flags propagate across active edges until settled, so an accumulator
resets before a later-declared input recomputes. A taken binding stops propagation
from its former inputs; sites still read only their direct input versions.

`features/derived/dom.ts` emits those checks before replay and saves input versions
after the computations finish. Each memo output has its own version. `const` memo
storage is writable by the compiler; authored assignments still throw TypeError
after native RHS evaluation and update coercion (`handlers.md`). Direct replay
writes bump versions without scheduling another batch. Functions created during
replay retain normal write notifications when called later.

`features/derived/takeover.ts` gives writable memo bindings with candidate later
assignments a local taken flag. Native assignment targets use temporary accessors:
only a successful store outside that binding owner's build scope takes control.
Equal assignments count; skipped logical assignments, empty loops, failed RHS
evaluation and uncompleted pattern targets do not. During replay, stores to taken
bindings are suppressed. A shared statement can still build active siblings;
each step retains its exact outputs, including individual destructured aliases.
An initializer or builder with no active outputs is skipped altogether.

`packages/runtime/src/build-scope.ts` tracks the executing component invocation
per application, independently of lexical nesting and entity id. Setup and replay
enter/leave that scope; a nested component temporarily owns it. Failed commits
clear ownership, and a queued microtask clears frames abandoned by throwing setup,
without generated exception wrappers. An error caught synchronously inside
authored setup does not restore an abandoned nested frame until the owning setup
leaves or the next boundary clears it; that recovery case remains open.

**Current boundary:** component-body declarations and definite builders only.
Nested-block memo storage, shared cells, dynamic escaping reads, possible-builder
observation and mutation commits remain pending. Local takeover is implemented;
module/closure takeover and callbacks discovered only through mutation observation
follow with those slices. This is not the full Phase 3 exit.

## What it does

Decides, for every binding in a component or module, whether it is a constant,
state or a derived value, and how each updates.

The compiler adds no meaning of its own. JavaScript runs as written; the compiler
only decides **what to re-run and when to update the UI**. Aliasing, in-place
`sort`, a mutated copy losing its edit when it is derived again: all of that is
JavaScript, and needs no rule here.

## Rules

`let` and `const` mean the same thing: either can be state or derived. A binding
follows the inputs of its computation until an actual later reassignment takes
control of it (approved 2026-10-20, superseding snapshots from initialization).

| Computed from | Has actually been reassigned later? | Kind |
| --- | --- | --- |
| nothing reactive | no | **constant**: computed once, never updates |
| nothing reactive | yes | **state**: holds its value until reassigned |
| something reactive | no | **derived**: re-run when what it reads changes |
| something reactive | yes | **state**: holds the later assigned value; no further derivation |

- **Reactive** means it reads a prop, state, derived value, source, ref or opaque node.
- **A global the program never writes is not an input** (`../decisions.md`,
  2026-10-21). `Math.PI * r`, `document.title`, `setInterval` and `console` are
  read as they are. A global the program writes (`count = 1` without a
  declaration, `window.count = 1`, `document.title = 'x'`) is an input. Method
  calls on a global (`localStorage.setItem`, `Math.random()`) are not writes.
  The rule is in `core/resolve/globals.ts`.
- **An import is the binding it names.** Importing a module constant gives a
  constant; importing module state gives state. A package import is opaque.
- **Opaque property reads.** A property read may run a getter or a proxy trap that
  reads other values, so it is opaque, except on a global the program never
  writes and on constant plain data: a never-written binding initialized with an
  object or array literal of literals, without accessors or spreads
  (`const sizes = ['s', 'm']`). The rule is in `core/resolve/members.ts`.
- **Reassigned later** means `x = …`, `x += …`, `x++` or `for (x of …)` in code that
  runs after the body: a handler, an effect, a callback ref, a timer or promise
  callback, or a function called from one of them. The executed write stops the
  binding being derived, even when it assigns the same value. A callback that
  never runs, an untaken assignment branch, and a short-circuit assignment that
  does not write leave the binding derived.
- **Writes in the component body are part of the derivation.** The declaration and
  every body statement that writes the binding (`if`, `switch`, loops) re-run
  together, in source order, when anything they read changes.
- After a later reassignment, the initializer and body writes that built that
  binding stop replaying. A delayed source must not overwrite the user's write.
- **Mutation is not reassignment.** `x.push(1)`, `x.a = 1` and `delete x.a` keep the
  binding's kind. The edit shows; on a derived value it lasts until the value is
  derived again (`tests/derived-const-mutation.test.ts`).
- **Props** are derived from the parent. Reassigning a prop is a local override
  until the parent passes a different value (`../decisions.md`, 2026-10-19).
- A value computed by a function the compiler cannot see is still derived. The call
  re-runs when its arguments or captured values change. What it reads that the
  compiler cannot see is opaque.

```js
const total = price * qty;            // derived: follows price and qty

let total = price * qty;              // follows price and qty until this click writes it
<button onClick={() => (total = 0)} />

let label = user.name;                // derived: the declaration and the if
if (!label) label = 'Anonymous';      // re-run together when user changes

let label;                            // derived the same way
if (user.name) label = user.name; else label = 'Anonymous';

let sum = 0;                          // derived: the loop re-runs when items changes
for (const item of items) sum += item.price;
```

### Callbacks

Timing belongs to an invocation, not a function's name or syntactic location.
A callback invoked while building its owning body's value contributes to that
derivation. The same function invoked later performs a later write. This includes
callbacks that run immediately and are also retained for future calls.

No list of timers, promise methods, observers or array methods determines these
semantics. Known behavior may remove bookkeeping only when the general result is
preserved. Unknown callers get the same runtime treatment.

The runtime must distinguish the owner whose derivation is executing: a callback
writing another component's state during a child render is not rebuilding the
parent's derivation. An async continuation after an `await` is later-running code.
Effects, refs and cleanup execute outside the body's derivation.

Reads and writes in callbacks that have not executed do not become dependencies
of the registration statement. Executed immediate callbacks contribute their
reads and writes. Detecting a reassignment must preserve assignment expression
results, prefix/postfix updates, destructuring, short-circuiting and exceptions.
Object mutation does not end derivation. Prop overrides still yield to a new
parent value.

### Timers and other setup side effects

A body statement that only *possibly* builds a value runs once, as the console
runs it. It joins the value's derivation only if that first run changed the value:
a callback it was given wrote the value during the call, or the deep-copy check
(below, "Which body statements build a value") saw a change. Otherwise it is never
replayed, not when its inputs change and not when the owner updates.

```js
let seconds = 3;
const id = setInterval(() => { if (seconds > 0) seconds--; }, 1000);
$cleanup(() => clearInterval(id));
```

1. Mount: the page shows `3`. `setInterval` did not call the callback during the
   call, so the statement is not a builder. One interval exists.
2. A click elsewhere updates the component. The statement does not run again: still
   one interval.
3. One second later the callback writes `seconds`: the page shows `2`, then `1`, `0`.
4. Unmount: `$cleanup` clears the interval.

No `$effect` is needed, and nothing names `setInterval`: the same holds for any
function given a callback. `console.log(doubled)` and `recorder.record(doubled)`
run once for the same reason; they read `doubled` and do not change it.

The compiler records these statements as `possible` builders (`BodyBuilder`
in `core/graph/model.ts`; `invocation: 'runtime'` when a callback decides). A
possible builder does not make its binding opaque; it sets `initial.opaque`, which
tells the emitted code to observe that statement's first run.

The reference uses memo setters to observe actual reassignment and compares the
invocation's component owner with the binding's owner. It records executed reads
through callbacks, props and module helpers, including immediate callbacks inside
effects. Source readiness is checked at body callback invocation. This bookkeeping
is test-only; production output continues to use the model in `output.md`.

## Inputs and outputs

- In: `Resolved` (initializer references, write sites and where they run,
  mutation sites).
- Out: `Constant`, `State` and `Derived` nodes with their `reads` edges. A `Derived`
  node lists the body statements that build it, in source order.

The graph classification is built (`core/graph/classify.ts`, described in
`core.md`):

| File | What it does |
| --- | --- |
| `features/props/classify.ts` | parameters of components: capitalized functions that own markup, or functions used as a JSX tag |
| `features/derived/computations.ts` | each binding's initial computation: initializer, pattern, body builders (definite or possible), reads, and candidate takeovers (later assignments) |
| `features/state/classify.ts` | the initial kind: `Prop`, `Constant`, `State` or `Opaque`; imports start as placeholders |
| `features/derived/classify.ts` | spreads reactivity through reads (a worklist, so cycles end); gives imports their definition's kind |
| `features/derived/plan.ts` | native declarations, definite builders, shared-statement groups and their version inputs |
| `features/derived/dom.ts` | source-ordered, version-guarded replay and writable memo storage |
| `features/derived/takeover.ts` | local takeover flags and native store targets, checked against runtime execution ownership |
| `features/derived/plan.test.ts` | pattern identity, definite versus possible builders, and untouched authored syntax |
| `features/derived/dom.test.ts` | native execution: call counts, loops, shared builders, declaration writes, pattern evaluation, const errors and callbacks created during replay |
| `features/derived/takeover.test.ts` | downstream call counts after takeover, helper invocation timing, partial patterns, sibling builders, loop targets and nested component ownership |
| `packages/runtime/src/build-scope.ts` | application-scoped invocation ownership for setup/replay, with nested restoration and exception-boundary recovery |
| `packages/runtime/tests/build-scope.test.ts` | nested owners, application separation, abandoned setup and failed replay |
| `features/state/plan.ts`, `features/state/dom.ts` | component-owned assignment storage and numeric versions |
| `*.test.ts` next to each | one test per rule above, on real parsed code |

A candidate takeover is never evidence that takeover happened: the runtime decides
when the write executes. Receiver mapping for `this` writes (`store.inc()` changing
the fields `inc` writes) is recorded in function summaries but not yet mapped to
the receiver's binding; the call itself is already a write of `store`.

## Where to add things

- A new way to write a binding (a new assignment form): `core/resolve/`, which
  finds write sites. The rules here do not change.

### Which body statements build a value

A body statement builds a binding when it reassigns it, or changes the value it
holds. Loops count like `if`: `let sum = 0; for (…) sum += x` is the same derivation
as `items.reduce(…)`, so it replays (`../decisions.md`, 2026-10-19).

Whether a call changes the value is decided like this:

- **Known methods**, from the list in `optimize/methods.ts` _(planned)_: the list says
  whether the method changes its receiver (`push`, `splice`, `sort`, `set`, …) or only
  reads it (`includes`, `map`, `slice`, `get`, …). No runtime cost.
- **Anything else** (an unknown method, or the value passed to a function): a runtime
  check around the statement. The value is deep-copied before, the statement runs,
  and the copy is compared after. If it changed, the statement builds the value from
  then on; if not, it only read it. Only these statements pay for the check.

```js
let picked = [];                                              // a handler pushes into it
for (const x of others) if (picked.includes(x)) count++;      // known read: builds count, not picked

const rows = [];
for (const n of items) rows.push(<li key={n}>{n}</li>);       // known change: builds rows

for (const x of others) picked.check(x);                      // unknown: checked at runtime
```

The list only makes this faster. A method that is not on it is still correct
(`../rules.md`, rule 3).

## Cases to test

**Verified takeover slice:** twelve selected `tests/cases/callbacks.test.ts`
comparisons cover registered/untaken handlers, equal assignments, aliased timers,
async continuations, logical assignments, postfix/pattern results, shared builders,
destructured siblings, and immediate opaque invocation without takeover. The
existing `a binding derives until a handler reassigns it` also passes. Eight native
execution tests cover the store/notification details; four runtime scope tests
cover nested owners, applications, throwing setup and failed replay. Full callback
acceptance still includes mutation, sources, components, effects and dynamic reads
that belong to the remaining slices.

**Verified memo slice:** six `tests/cases/memos.test.ts` comparisons cover chains,
loops with break/continue, switch, pattern defaults/rest and shared builders.
The existing const-derived, body-write, if/else and destructuring cases also pass
on compiler-next. Ten direct execution tests and three plan tests cover the
ordering and call-count details above without relying on the reference renderer.

The two shared-builder comparisons exposed a reference feedback loop. Its
`transform.ts` now gives definite shared targets their common external inputs;
`runtime.ts` excludes their internal reads and captures the settled inputs after
the shared statement. Their expected outputs were not changed.

In `packages/compiler-next/tests/cases/state-and-derived.test.ts`. Each must compile
and show on the UI what the console shows.

The old compiler fails these:

- `let label = user.name; if (!label) label = 'Anonymous';`: rejected.
- A loop in the body, `for (const item of items) sum += item.price`: it does not
  re-run when `items` changes.
- `<p>{a}{b} {count}</p>`: adjacent text values are joined with `+`, so two numbers
  are added (`0` instead of `00`, `2` instead of `11`).
- A body loop that only reads a list (`if (picked.includes(x)) count++`): `count`
  never updates (same cause as the loop above).
- A body loop that calls an unknown method: `bag.add(n)` that changes `bag`, and
  `picked.has(x)` that only reads it. Neither updates.

These pass today and must keep passing:

- a counter;
- a `const` derived from state;
- an `if`/`else` that assigns in every branch;
- `sorted.push(x)` on a sorted copy, then the source changes;
- `const items = makeList()`, written, then rendered as a list;
- writes on a `[1].concat([2])` result;
- reassigning a prop with `++`, then the parent sends a new value;
- writing a module value derived from module state;
- destructuring reactive state.
- values returned by helpers, `concat`, an object spread member and `Array.from`,
  with both `let` and `const`, rendered as text or keyed rows;
- mutation of computed-key objects and helper-returned objects;
- a handler reading a method chain on an array literal;
- array, object and `new Set` initializers reading state;
- reassigning a module object;
- mutating a derived copy, then mutating its source;
- prop overrides surviving unrelated prop updates, updating derivations, and
  remaining independent in keyed rows.

The ported root regressions also assert the known text after each step on both
renderers (`Case.check`), independently of their DOM comparison.

The reference gives destructured aliases independent memos: the authored pattern
runs natively once per changed input, and an alias stops following it on its actual
later reassignment. Source/default/rest cases are on `sources.md`. Module derivations
refresh before component rendering.

Module derived bindings now support later reassignment, including imported live
bindings. Module body control flow and derivations inside arbitrary factory
closures still need the broader reference coverage already listed on `sources.md`.

### Callback verification (2026-10-20)

`tests/cases/callbacks.test.ts` has 22 explicit cases. All pass on the reference;
all fail on the old compiler. Both reference and old compiled versions were
generated for all 22 under `tests/out/callbacks-*/`.

| Cases (the `callbacks:` prefix is omitted) | First expected result the old compiler misses | Old result |
| --- | --- | --- |
| registered handler; setup-and-later callback; aliased timer; async continuation; effect writing branch; child calling parent; props/module helper reads | `30` after the input changes, before a later write | `20` |
| equal assignment | `22` before the equal assignment freezes it | `20` |
| inline arrow; named callback/alias; IIFE; synchronous `.then`; shadowed `setTimeout` | `9` after changing the factor | `6` |
| short-circuit assignments | `2:2:2` after skipped writes | `1:1:1` |
| destructuring and postfix | `2:4:0` before reassignment | `1:2:0` |
| object mutation before reassignment | `2` when the input changes after a local mutation | `99` |
| imported module binding | `15:30` | `15:20` |
| shared statement building two values | `2:4` | `1:2` |
| immediate callback reading a source | Pending UI; an early override subsequently stays `99` | Throws `UnresolvedDataReadError` at mount |
| stored source reader | `4` before the stored callback runs | `2` |
| immediate callback inside an effect | `30:1` after the price changes; later takeover becomes `80:2` | `20:1` |
| returned callback values with captured sources | Pending UI, then `6,12` once the source resolves | Throws `TypeError` reading `values.join` while `values` is undefined |

Four existing expectations intentionally changed with the user's approved rule:
the handler example now shows `20` before reset (old: `10`); the class constructor
shows `2:2` before replacement (old: `2:1`); the getter alias shows `4:4` before
save (old: `4:2`); the rest alias shows `2|3:-` before replacement (old: `1|2:-`).
The first example previously had no explicit check; it now checks every step.
The other source, mutation, prop-override and lifecycle expectations were kept.

Four timer and side-effect cases were added on 2026-10-21. They use the harness's
`{ advance: ms }` step (`testing.md`) and pass on the reference:

| Case | Old compiler |
| --- | --- |
| a `setInterval` countdown works without an effect and registers once | passes |
| `$cleanup` stops a component timer when it unmounts | passes |
| a `setTimeout` write takes over a derived value when it fires | fails: `20` after the price changes, expected `30` (the old snapshot rule) |
| passing a value to an unknown call that only reads it runs once | passes |

Five "unknown callers" cases were added the same day (`output.md`, "Phase 3
design", rule 5). An unknown call must not re-run on unrelated updates, yet must
follow the visible reactive state it reaches. All pass on the reference, which
now tracks state in helper and factory closures (`tests/reference/closures.ts`):

| Case | Old compiler |
| --- | --- |
| a method on an object follows the state it reads | fails: `20:0` after the price changes, expected `30:0` |
| factory functions taken out by destructuring follow their closure | fails: `2` after `inc()`, expected `4` |
| a getter on an object passed as a prop follows the parent state | passes |
| a host function that runs a callback at once follows its captures | fails: `2,4` after the factor changes, expected `3,6` |
| a call with a side effect runs once across unrelated updates | passes |

Remaining coverage: generator callbacks across `yield`; readiness inside async
callbacks before their first `await`; module body callback builders; callback
dependencies in arbitrary factory closures. These are reference limits, not
exceptions to the uniform rule. Do not assume the current passing set proves them.

### Mixed state, classes and accessors

Fourteen `complex state:` cases combine module and component state with native
class behavior. They have explicit assertions after each interaction. The old
compiler passes thirteen and fails one:

| Case | Expected | Old compiler result |
| --- | --- | --- |
| `complex state: static class fields and getters feed component derivations` | Both summaries change from `3` to `5`, then `7` | Both stay on `3` after the first static-field write |

The passing cases cover shared module instances alongside independent component
instances; constructors with reactive arguments and constructor snapshots;
preserving instance edits across unrelated writes; getters, setters, postfix
results and clamping; inheritance, `super` and overridden methods; object-literal
accessors; an imported class store combined with module and component values;
constructors returning ordinary objects; direct private-field reads/writes through
accessors and methods; computed accessors and destructured snapshots; setters
updating several fields seen by sibling components; unused own getters; and
symbol-backed accessor derivations.

The reference's own-property snapshots (`tests/reference/runtime.ts`) inspect data
descriptors, including symbols and non-enumerable backing fields, without
invoking own getters. Constructor functions with static data are snapshotted too.
Three unchanged assertions caught reference bugs before comparison: static fields
were ignored, symbol data was ignored, and snapshots executed an unused getter.
All fourteen cases now reach the old compiler and have both generated versions.

This is not exhaustive class coverage. Still to model and test: cached derivations
whose only input changes are private fields or values captured by getters; further
prototype/descriptor changes; and Proxy/WeakMap-backed state. The tested private
case reads the accessor directly in JSX; it does not validate private-only memo
invalidation. These remain correctness requirements, never permitted failures
for the rewrite. JSX combinations with class instances are on `components.md`.

### Spread, rest and recursive helpers

Eleven more cases check ordinary copy/rest patterns and recursive computation.
The ten `spread/rest:` cases cover the exact `const a = [...b]` and `{ ...b }`
forms: local mutations survive unrelated writes and reset when their source
changes. Both copies remain shallow. A write through a shared nested reference
also changes the source, so the derived copy replays under rule 11. Native array
and object rest, computed exclusions, symbols, defaults, reassigned rest snapshots,
rest parameters/spread arguments, and module-to-component copy chains are covered.
The `recursive patterns:` case uses mutually recursive helpers over a nested tree.

The reference passes all eleven. The old compiler passes rest parameters with
spread arguments and nested rest/default patterns; nine cases fail:

| Case | Expected | Old compiler result |
| --- | --- | --- |
| `spread/rest: array copy mutations survive unrelated writes until the source changes` | After editing `a`, changing `b` rebuilds `a` as `1,2,3` | `a` stays `1,2,9` while `b` is `1,2,3` |
| `spread/rest: object copy writes additions and deletions reset only with its source` | Source mutation restores `a.qty = 2`, `label = 'base'`, and removes the local extra field | Keeps `qty = 9`, missing label and the local extra field |
| `spread/rest: array spread is shallow and nested mutations still reach the original` | Shared nested mutation changes both sources and replays `a` to just `2` | Nested value changes, but `a` incorrectly retains its appended `9` |
| `spread/rest: object spread shares nested references while isolating top-level writes` | Shared nested mutation replays `a.count` to source value `1` | Keeps local `a.count = 9` |
| `spread/rest: array destructuring rest can be mutated and rederived` | Pushing `9` into `tail` shows `2,3,9` immediately | Still shows `2,3` |
| `spread/rest: computed object rest excludes selected keys and retains symbols` | Setting `rest.other = 9` shows `9`, retaining its symbol and excluded-key behavior | Still shows `2` |
| `spread/rest: a reassigned rest binding is a snapshot while other aliases remain derived` | Before takeover, source mutation updates `selected` to `2` and `rest.other` to `3` | Both remain `1` and `2`; later override assertions are not reached |
| `spread/rest: module and component copies each preserve local edits until their input changes` | Updating `moduleCopy` to `1,9` replays `localCopy` to `1,9` | `localCopy` keeps its stale `1,8` edit |
| `recursive patterns: mutually recursive helpers rederive from nested state` | Native recursion computes `3`, `4`, `8`, then `16` as nested state/module factor change | Rejects recursive helper `sum` as something that "cannot be analyzed" |

All assertions are unchanged. Ten cases have both generated versions; the
mutually recursive helper is rejected before emit. Further recursive/aliasing
programs belong in the generator too, not just hand-written examples.
