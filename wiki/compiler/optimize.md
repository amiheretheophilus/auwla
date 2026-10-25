# Optimizations

**Folder:** `optimize/`. The stage and disable switch are built; passes follow.

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
| `methods.ts` | Removes redundant call observation only when callee/receiver and effect proofs cover the executed operation. Method spelling alone never skips observation; unknown or overridden calls retain the before/after check (`state-and-derived.md`) |
| `keyed-map.ts` | keyed `.map` over state reuses rows |
| `array-ops.ts` | `push`, `splice`, `sort` update only the rows they touch |
| `dom-only-rows.ts` | rows with no reactive work are plain DOM |
| `reason-routing.ts` | a write updates only the sites on its paths |
| `static-hoist.ts` | static templates are created once |

## Implementation order after Phase 6

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
