# Optimizations

**Folder:** `optimize/` _(planned)_.

## What it does

Holds every fast path. The general rules in `features/` handle all valid code;
an optimization only makes a case faster.

## The contract

```ts
interface Optimization<P> {
  name: string;
  /** A faster plan that behaves the same, or null to keep the general one. */
  match(general: P, graph: ComponentGraph): P | null;
}
```

## Rules

1. **An optimization never rejects code.** When it cannot prove its case, it returns
   `null` and the general path runs.
2. **Method-name and API-name lists live only here.** No feature decides behaviour
   from a name (`../rules.md`, rule 3).
3. **Each optimization is proven by testing:** every comparison test runs with
   optimizations on and off, and both must match the reference (`testing.md`).
4. **List optimizations also need `bench/`:** the numbers must not regress below the
   `d6e678b` baseline (`testing.md`).
5. **Optimizations run after the plan is built and before emission**, in the order
   listed in `optimize/index.ts` _(planned)_.
6. **Correct first.** A case gets its general path, with tests, before any fast path
   for it is ported.

## Planned optimizations

| File | Makes faster |
| --- | --- |
| `methods.ts` | what known methods do to their receiver: change it (`push`, `splice`, `sort`, `set`, …) or only read it (`includes`, `map`, `slice`, `get`, …). A read skips invalidation, and a body statement that only reads a value does not build it. Unknown calls fall back to the runtime before/after check (`state-and-derived.md`) |
| `keyed-map.ts` | keyed `.map` over state reuses rows |
| `array-ops.ts` | `push`, `splice`, `sort` update only the rows they touch |
| `dom-only-rows.ts` | rows with no reactive work are plain DOM |
| `reason-routing.ts` | a write updates only the sites on its paths |
| `static-hoist.ts` | static templates are created once |

## Where to add things

- Add a file, register it in `optimize/index.ts`, add its test and, for lists, a
  bench case.
