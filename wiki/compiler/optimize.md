# Optimizations

**Folder:** `optimize/`. The stage, disable switch, retained-list-index pass and
method-call pass are built. Further list fast paths remain below.

## What it does

Holds every fast path. The general rules in `features/` handle all valid code;
an optimization only makes a case faster.

## The contract

```ts
interface Optimization {
  readonly name: string;
  /** A faster plan that behaves the same, or null to keep the general one. */
  match(general: ModulePlan, graph: SemanticGraph): ModulePlan | null;
}
```

## Rules

1. **An optimization never rejects code.** When it cannot prove its case, it returns
   `null` and the general path runs.
2. **Names never establish semantics or purity.** No feature decides behaviour
   from a method or API name (`../rules.md`, rule 3). Recognizing a spelling can
   suggest a candidate, but cannot authorize a fast path. The actual callee,
   receiver, aliases, property access and executed callback effects must satisfy
   its proof conditions; otherwise retain the general observation.
3. **Each optimization states its proof conditions and tests both paths.** Every
   comparison test runs with optimizations on and off, and both must match the
   reference (`testing.md`). Tests support the contract; a passing benchmark
   fixture does not establish that the proof covers every valid input.
4. **List optimizations also need `bench/`:** the numbers must not regress below the
   `d6e678b` baseline (`testing.md`).
5. **Optimizations run after the plan is built and before emission**, in the order
   listed in `optimize/index.ts`. `compileModules(..., { optimize: false })`
   bypasses all optional passes. The comparison harness emits both strategies,
   into `next/` and `next-general/`, and checks both against the reference.
6. **Correct first.** A case gets its general path, with tests, before any fast path
   for it is ported.

## Planned optimizations

| File | Makes faster |
| --- | --- |
| `retained-list-index.ts` (built) | Selects private row-index retention for non-primitive child sites, without changing authored expression evaluation |
| `methods.ts` (built) | Lowers observed member calls to `observeMethod`; the runtime skips the snapshot only when the actual callee, receiver, arguments and callbacks satisfy its proof. Unknown or overridden calls retain the before/after check ("Method calls" below) |
| `keyed-map.ts` | keyed `.map` over state reuses rows |
| `array-ops.ts` | `push`, `splice`, `sort` update only the rows they touch |
| `dom-only-rows.ts` | rows with no reactive work are plain DOM |
| `reason-routing.ts` | a write updates only the sites on its paths |
| `static-hoist.ts` | static templates are created once |

## Retained row index

The first pass changes only private row matching. It returns fresh component,
branch and stored-value plans whose non-primitive text sites select
`createIndexedValueSlot`. `core/emit/sites.ts` lowers that choice; this is still a
general child-value site, not an explicit iteration plan. The planned explicit
list emitter belongs in `features/lists/` when iteration lowering is built.
Neither the authored AST nor its graph identities change.

`packages/runtime/src/list-index.ts` retains the first row for each identity.
Every reconciliation uses a fresh identity token to consume each old row at most
once. Unmatched primary rows are disposed in old row order, followed by old
duplicates in their old order, exactly as `list-values.ts` does. A cache is valid
only for the exact private row array it indexed. It detaches before authored
getters, key coercion or cleanup can run; a throw discards partial indexing, and
reentrant calls use independent records. Slot clearing releases the cache.

Both strategies use `list-values.ts` for array-child traversal: native length
conversion, holes, inherited indices and one read per present value. The fast
path makes no assumption about the array-producing expression, method names,
callbacks, object aliases or key types. Native calls and mutation observation
remain intact. It still traverses rows and allocates next-row/value arrays;
render-value captures, row callbacks and opaque snapshots are not removed by
this pass. The retained map adds one private record per distinct live identity.

`runtime/tests/list-index.test.ts` checks duplicate/state/disposal behavior,
throwing keys, reentry, inherited getters and 3,375 three-step sequences of
binary-key lists up to length three against the unchanged general matcher.
Native compiler checks retain custom/overridden calls and callback arguments.
The unchanged 1,000-row inline fixture, selecting four different rows, builds
four matching maps in general mode and zero new matching maps in optimized mode.
A 30-update matcher check builds 30 general maps versus one retained map.
These are work counts, not VM timing or memory results.

## Method calls

The general path observes every call that may edit state by snapshotting all the
data its reads reach, before and after (`handlers.md`). On 10k rows that is about
70 ms per call, for `items.slice(1)` as for `items.map(row => <tr …/>)` in a
render site, so every update of a large list paid it.

`optimize/methods.ts` lowers each observed plain member call to
`observeMethod(reads, notifications, receiver, key, proven)(...arguments)`. That
keeps native order: receiver, key, one method read, arguments, call. Calls with an
optional link anywhere in the callee chain, spread arguments, `super` or a private
name keep the general form. The pass never reads the method name. For each inline
function argument it sets bit `i` of `proven` when the body makes no explicit call,
`new`, tagged template, store or update outside its own locals, `delete`, class,
array destructuring, `for…of`/`for…in`, array spread or suspension. Nested function
bodies are skipped: creating a function runs none of its body.

`runtime/src/method-calls.ts` holds the proof. It keys on the callee's identity:
the `Array.prototype` intrinsics captured when the runtime loaded. The conditions:

- the receiver is an array, and for species-creating intrinsics its prototype is
  `Array.prototype`, with no own `constructor` and the intrinsic species. These are
  checked through descriptors, so no getter runs;
- every argument the intrinsic converts to an integer is a primitive;
- its callback argument has its `proven` bit (`sort` may also omit it);
- for intrinsics that edit their receiver, every read returns that receiver.

Species eligibility is checked again after arguments finish: argument evaluation
can install a different constructor or species after the native method read.
Such a call retains the captured callee and takes the general observation path.

A proven read-only call then runs with no observation. A proven edit is reported
with `observeReceiverEdit`: stamp, notify every read, then notify aliases. It keeps
a pending entry, so a call that throws midway is still reported at the next
recovery. Anything unproven is observed as before. An unknown callee starts its
observation before its arguments are evaluated, as the general form does.

Descriptor reaches remember when they encounter accessors or sparse arrays.
A receiver edit discards such a reach: native `reverse` can move a getter or
inherited value into an own data element without taking that object as an
argument. The next alias lookup rebuilds from the resulting data, including after
an interrupted native call. Dense data reaches record only arguments actually
inserted: all arguments of push/unshift, splice's arguments after index 1, and
fill's first argument. Sorting adds no comparator, and the temporary argument
array is never indexed as receiver data. Native regressions and a both-mode DOM
check cover the previously missed later notification; unused getters stay unused.

The proof boundary is the same one compiled code already uses elsewhere. What a
proven call can still run is property reads (getters, proxy traps) and implicit
conversions. Compiled code never observes those for an ordinary `row.label` read
or `a + b` either, and compiled getter bodies report their own state writes.
Replacing `Array.prototype.slice` after the runtime loads installs a function
without a proof. Replacing it before then is a known limit.

The proven set: `slice`, `concat`, `indexOf`, `lastIndexOf`, `includes`, `at`,
`toReversed`, `with` and `toSpliced` allocate a fresh result. `map`, `filter`,
`find`, `findIndex`, `findLast`, `findLastIndex`, `some`, `every`, `reduce` and
`reduceRight` call a proven callback. `push`, `pop`, `shift`, `unshift`, `reverse`,
`splice`, `fill` and `sort` edit the receiver. Calls into compiled helpers
(`updateRows(items)`) stay observed. A helper's body does not report edits to the
objects it receives, so compiling the callee is no proof.

Checks: `runtime/tests/method-calls.test.ts` covers that proven calls never take a
snapshot. It also covers own or replaced methods, subclass species,
`valueOf`-converting arguments, effectful callbacks, a receiver that is not the
read value, native order, and a throw mid-edit. `optimize/methods.dom.test.ts`
covers the callback classification and native updates, overridden methods,
effectful callbacks and evaluation order, in both modes. On 10k plain rows (Bun,
runtime source), `slice(1)` goes from 84 ms to 0.11 ms, `map` from 68 ms to
0.47 ms, and `reverse()` from 82 ms to 0.03 ms. These are micro timings; VM
results are still needed.

## Keyed comparisons

Every component row reads `selected === props.item.id`, so changing `selected`
woke all 10k rows: 10k notifications, batch marks and updates for a change that
flips two classes. `optimize/keyed-comparisons.ts` marks `x === e` and `x !== e`
when all of these hold:

- `x` is a plain reference to a shared binding owned by this module, on the left,
  so it is read first as written;
- `e` has no explicit effect (`effects.ts`);
- `e` does not read `x`.

The emitter (`features/state/shared-dom.ts`) declares `_peek_x` and `_version_x`
next to the reader. It replaces the comparison with
`trackEquals(_peek_x(), e, _peek_x, _version_x, key)`, negated for `!==`.

`trackEquals` (`runtime/src/computation.ts`) records a keyed dependency: only
whether `value === e` held. A publish of the key notifies the readers keyed by
the new value plus those that matched before. It does not need every earlier
value to have been published. `===` never converts, so the result can flip only
for those readers. Map keys treat `NaN` as equal, which at most adds a
notification. A computation that compares the same key with two values, or also
reads it plainly, falls back to a plain dependency. `changed()` reports a keyed
dependency only when the comparison flips.

Checks: `runtime/tests/computation.test.ts` covers that 1,000 readers wake 2 per
selection, re-runs, the fallbacks and disposal. `optimize/keyed-comparisons.dom.test.ts`
covers which comparisons qualify, and identical classes in both modes through
selection, reselection, `NaN` and a row whose key changes. The DOM bench fixture
counts 1, then 2, row updates per selection, against every row on the general
path. Inline rows still re-run the whole `items.map`, which needs list lowering.

## Row reuse

Every list change re-ran `items.map(callback)` for every item. A profile of
removing one of 10k component rows shows the callbacks, their allocations and the
resulting GC as the largest cost. Each row's value was then re-checked downstream
(`sameProps`, `mutatedSince`), though almost nothing had changed.

`optimize/row-reuse.ts` proves facts about a callback argument. It never looks at
the method name. The callback must:

- be an arrow taking at most `(item, index)`, without a rest parameter;
- have no explicit effect (`effects.ts`);
- return JSX on every path, a compiler-owned value, so reuse never hands authored
  code a shared object;
- read nothing reactive except through tracked readers (shared bindings), besides
  its own parameters and locals. Other free variables must be constants that
  depend on nothing reactive (`isReactive`), or globals the program never
  writes. Bodies of nested functions are not run, so they do not count.

`optimize/methods.ts` records `rowReuse` on the call. The emitter declares one
`createRowCache(usesIndex)` per call site and owner instance, and passes it to
`observeMethod`. It is used only once the runtime has proven the callee is the
intrinsic `map` on an ordinary array.

`runtime/src/list-map.ts` reuses an item's previous result when all of these hold:

- the occurrence is the same value as before (duplicates keep their order);
- nothing below it was edited since (`mutatedSince`);
- the index is the same, when the callback reads it;
- the row's computation reports no changed tracked read.

Otherwise it calls the callback inside that row's computation. Every row shares
its reads with the computation around the call, so the site still re-runs when
any of them changes. The result has native `map`'s shape: the same length and
holes, and the same `thisArg` and arguments.

The cache retains its previous rows in occurrence order. An unchanged prefix
already identifies the first unused occurrence, so it is consumed directly.
Only the first mismatch builds a temporary lookup of the remaining old suffix.
Initial creation, unchanged mappings, append and truncation need no matching map.
This replaces generation bookkeeping that reduced allocation but regressed
creation in the controlled runner comparison; allocation counts alone are not
performance evidence.

The cache detaches before length or element reads can run authored code, so
reentry uses independent state and an exception cannot publish a partial pass.
An empty result drops all rows at once. Authored items and results are untouched.
The work check creates zero matching maps through creation, 30 unchanged updates,
append and truncation. Native cases compare all 3,375 three-step binary-item
sequences with a linear first-unused model, with index use on and off, and cover
holes, duplicate edits, throws, reentry and collection of removed items.
Mapping and reconciliation still scan every row; structural updates are not yet
targeted to their changed positions.

The item lookup supplies only a candidate. `Object.is` checks it before reuse,
because a Map groups signed zeros while JavaScript arithmetic distinguishes
them. `list-values.ts` shares native length conversion with the map cache, so
proxy-supplied lengths truncate, clamp or throw as native `map` does. Runtime
regressions cover these boundaries; a both-mode DOM check swaps signed zeros.

A reused value is marked verified at the current mutation time. A value slot
writing that same value again skips its update only if nothing at all was edited
since. So an edit during the update, for example by a child's setup, still takes
the full path.

Component state and props read inside a callback are already emitted as tracked
reads (`ComponentPlan.trackedReads`, `trackRead(() => version, …)`). Row reuse
accepts exactly those reads. `keyed-comparisons.ts` also keys
`x === e` at such a read: the emitter in `core/emit/dom.ts` writes
`trackEquals(x, e, () => x, () => version, key)`. A selection then rebuilds only
the rows whose comparison flips. The site still re-runs on the version change
and checks each row, so this is O(rows) checks, not O(rows) rebuilds. Every bench
variant and Octane's rows qualify.

Checks: `runtime/tests/list-map.test.ts` covers reuse, in-place edits, index use,
holes, duplicates, `thisArg`, tracked reads, dependency sharing and the verified
mark. `optimize/row-reuse.dom.test.ts` covers which callbacks qualify, and
identical output in both modes through edits, replacement, reversal, duplicates,
shared and local reads.

## Row lists

The old compiler's list shape (`../decisions.md`, 2026-10-25): when a text site's
whole value is `items.map((item, index) => <li key={…} …>)`, the rows are
compiled and reconciled from the array, with no render value, capture array,
row closure or nested value slot per row.

`optimize/row-lists.ts` marks the site (`TextSite.listStrategy: 'rows'`) and its
call (`method.rowList`) when:

- the call has row reuse (`row-reuse.ts`), so the runtime proves the intrinsic
  `map` before the list is used, and otherwise the callback runs as written;
- the callback's body is one element with one root, and its parameters are
  plain identifiers;
- the root's `key`, if any, is its first site, so evaluating it before the row
  keeps the authored order;
- the site belongs to a component's own template (or a conditional branch of
  it), where the callback is evaluated. Rows inside stored JSX stay general.

`core/emit/row-list.ts` declares, before the site evaluates, a key function and
a row factory taking the callback's parameter names, and
`createRowList(anchor, owner, key, create)`. A row's update assigns its
parameters and evaluates every site again in order; a handler written as a
function literal is created once and reads the assigned parameters. The mutation
lowering passes the list to `observeMethod` (`Names.of` gives both emitters the
same name). The site writes `list.write(value)`.

`runtime/src/row-list.ts` reconciles with the general path's identity and order
(`list-values.ts`, `list-index.ts`, `render-value.ts`): `key=` and the key as a
string, or `#index`; each identity reuses its first old row; old duplicates are
never reused; unmatched rows are removed in old order, then old duplicates; a
reused identity whose key value changed by `Object.is` (`1` after `'1'`) mounts
again, after those removals. Faster than the general path: an unchanged ordered
prefix needs no lookup or key string, moves follow the longest increasing
subsequence (`list.ts`), and a list that is all of its parent clears with one
`replaceChildren`. `map` returns a token the site's `write` ignores; any other
value (an unproven callee ran the callback) goes to a value slot at the same
anchor, and the next proven `map` clears it.

Without `try`: a pass records the rows it creates. A throw leaves them pending,
and the next pass or disposal removes them; the committed rows stay. A getter
that renders the same site again supersedes the pass it interrupted: the inner
pass recovers the outer one's new rows and commits, and the outer pass stops.

What differs from the general path is only timing the console cannot see: a row
mounts while its item is evaluated, before unmatched rows are removed, and
sibling rows leave the DOM together when the whole parent clears.

Checks: `runtime/tests/row-list.test.ts` compares reuse, creation order and
disposal order with `reconcileList` for every two-step sequence of up to three
keys over `1`, `'1'`, `2` and `null`, keyed and unkeyed (7,225 each), plus holes,
moves, bulk clearing, a throwing key, reentry and the slot fallback.
`optimize/row-lists.dom.test.ts` compares each step's DOM node identity in both
modes through moves, duplicates, holes, `'1'`/`1` keys, `reverse`, `splice`,
edits and clearing, and covers handlers after a swap, a receiver with its own
`map`, stored JSX and arrays inside rows, SVG rows and the qualification limits.

## Implementation order after Phase 6

Write batches now share recovery scheduling and publish dirty entities in groups
through the existing kernel commit. The native 200-row listener check drops from
201 recovery callbacks and 200 commits to one of each, without skipping a row.
Completed batches also release row data before queued recovery runs. Error,
ordering and ownership boundaries are on `handlers.md`.

The same-compiler ABBA comparison from `d5abe1f0` to `248f8a83` passes every
placement/identity gate and improves component-row updates in both orders. At
10k, module-component update is 57.2 to 28.2 ms and 75.2 to 52.8 ms; module-data
component update is 60.2 to 39.4 ms and 78.2 to 51.6 ms (seven samples per cell).
Clearing and inline-row changes are mixed, and creation cells show substantial
runner drift. Same-run old/next timings still show a large gap. The update profile
continues to show recursive mutation reachability and `mutatedSince` checks,
mapping/reconciliation and GC. Results and raw-sample locations are in
`../status.md`; this does not close the performance floor or the reported VM OOM.

Row creation also pays fixed runtime ownership costs. Computation disposal
registration now waits until the collector actually subscribes. In the unchanged
module-data component fixture, creating 1,000 rows adds zero ownership entries
instead of 3,000, and zero per-row ownership sets instead of 1,000. The collectors
still run and can discover reads later; authored expressions and prop guards are
unchanged. Both compiler modes check those counts along with update and clear.
The lifecycle and retention contract is on `state-and-derived.md`.

The isolated ABBA runner comparison at `8ede65b2`'s runtime, against `4fde956e`,
passes placement and identity gates in both orders. Owner-component clear 10k is
33.5 to 26.0 ms and 29.4 to 25.5 ms (seven samples). Creation is mixed, and
module-component clearing is slower in one order. This supports a limited
teardown benefit, not a general creation win; the old compiler remains faster.
The run, raw-sample location and other measurements are recorded in `../status.md`.

1. **Establish the work being removed.** Inspect the emitted inline-row and
   component-row programs and extend the existing fixture work counters where
   needed. Count row evaluations, snapshots, listener changes and DOM writes;
   correctness counters do not substitute for VM timings or memory measurements.
2. **Build the optimization boundary first.** Add `optimize/index.ts` between
   planning and emission in `pipeline.ts`, with a switch to disable the passes.
   Each pass returns a new plan or keeps the general one. It never edits authored
   AST nodes, and graph facts remain keyed by resolved bindings/references.
3. **Remove list allocation and repeated row work.** A proven keyed iteration
   can retain row programs and their state instead of allocating render-value
   arrays, capture tuples and closures for every unchanged row. Callback arguments
   (including index and collection), evaluation order, side effects and key
   behavior remain part of the proof. Unsupported shapes use the existing array
   value-slot reconciliation.
4. **Route changes to affected outputs.** Use dependency and write paths to avoid
   unrelated row/site work. Selection can touch the previous and new matching
   rows only when the row's other inputs and observable work are unchanged.
   Preserve listener captures and native event behavior before reducing listener
   replacement; delegation is not a general assumption. Direct primitive text
   writes already exist in `core/emit/sites.ts` and are not a new optimization.
5. **Remove observation only with an effect proof.** Even native `Array.map` can
   run callbacks or accessors that mutate state. A custom method called `map` can
   do anything. Keep native call evaluation and the opaque fallback whenever
   those effects cannot be accounted for. Targeted array operations need the same
   argument, alias, callback and exception guarantees.

Passes live in `optimize/`, general language behavior in `features/`, shared plan
types in `core/plan/`, and reusable DOM/lifecycle operations in `packages/runtime/`.
An explicit list plan's emitter belongs in the planned `features/lists/` folder;
recognition/proof logic stays in its optimization pass. A feature never imports
another feature, and only `pipeline.ts` orders compiler stages.

Each pass includes native checks for why it applies and why it must fall back:
overridden/unknown methods, mutating callbacks, getters, aliases, sparse arrays,
index/collection arguments, duplicate or changing keys, and partial writes before
an exception. Run unchanged comparison cases and generated programs with passes
enabled and disabled. Validate retained DOM, state and disposal alongside output.
Keep the cases, proof limits and file map on this page and the relevant concept
page. Readable helpers and comments explain each proof and fallback boundary.

Start with the stage/switch and one list pass. Add further passes only after that
pass's correctness and work checks hold. The performance exit still requires
fresh VM speed and memory results against the old compiler, including the workload
that previously ran out of memory.

## Where to add things

- Add a file, register it in `optimize/index.ts`, add its test and, for lists, a
  bench case.
