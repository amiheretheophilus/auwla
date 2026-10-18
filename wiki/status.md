# Status

Last updated: 2026-10-18.

## Branches

- `compiler-refactor` (working branch). Created from `stress-round-5` at `73f5f34`.
- `codex/package-conditional-sync` at `9e35480` (third-party package compilation,
  development inspector, authored JSX diagnostics) is merged in as `616348a`,
  without conflicts. Merged so that branch is not stranded by the refactor.
- The user put the agent in charge of the refactor on 2026-10-18 ("you are in charge now").

## Done

- `73f5f34`: readiness. Code that depends on a loading source waits for it:
  state seeds, early returns, effects (also through derivations), chained requests,
  for module and local sources alike. `tests/body-readiness.test.ts` (10 cases).
- `73f5f34`: server renders real HTML; SSR group errors and null-source branches.
- `8a12eaf`: this wiki.

## Baseline (merged tree, 2026-10-18)

- `bun install` was needed after the merge (devtools adds `@fontsource-variable/geist*`).
- `bun run build` passes.
- Root tests: **every file passes when run alone.** Run in batches of 15 files
  in one process, 42 tests fail; all of them pass alone, so they are cross-file
  interference (shared global state), not compiler bugs. Use the same batches to
  compare before/after; use single-file runs to confirm a failure is real.
- Batch runner: `run.sh` in the scratchpad (`bun test $(15 files)` per batch).

## Slice 1, one readiness pass (committed, vite suite not yet re-verified)

Replaced `dom/read-rewriting.ts`, `dom/read-transforms.ts` (gating parts) and
`dom/module-read-lowering.ts` with `src/readiness/`:

- `facts.ts`: per component, read once on the untouched tree: sources (local,
  module, event), every source occurrence (payload read or holder use), every
  derivation reference, seeds, skipped containers, parents.
- `lower.ts`: builders that copy authored nodes into lowered form (`param`,
  `render`, `throw` read modes; derivations inlined). They never read their own output.
- `index.ts`: decides each sink (derivation, chained call, seed, effect, render
  site, imperative read), collects edits, applies them once, one scope refresh.
- `normalize.ts`: helper payload reads and early-return normalization (moved as is).
- `dom/data-sites.ts`: `automaticSiteExpression` is the pure builder;
  `wrapAutomaticSite` (still used by group lowering) wraps it.

Intended behaviour changes, to check against tests:

- Module sources follow the same render-site rules as local ones (before, a module
  read in a plain slot never got the pending/error presentation, but the same read
  through a derivation did).
- A module source is referenced by its import binding (it already is
  `sourceRef(key)` at runtime), not a re-created `sourceRef(key)`.
- A source handed to a child (`<Card user={article}/>`) inside a control-flow site
  stays the source; before, it became the payload.
- Nested automatic sites inside an outer site that already waits are not emitted.

### Verification tools

- `packages/compiler/src/corpus.ts`: with `MEMO_DOM_CORPUS=<dir>`, every public
  compile call with plain-JSON arguments is recorded with its output.
- `packages/compiler/scripts/corpus-diff.ts <dir> [diff-dir]`: replays the corpus
  against the built compiler; reports changes, ignoring generated-name numbering.

## Slice 1 verification (2026-10-18)

- Corpus: 1,632 recorded compile calls; 1,587 identical, 45 changed. All 45 reviewed:
  intended unifications (module sources follow local rules; selectors stay immediate;
  sources handed to children stay sources) and two old bugs fixed (reads lowered inside
  generated arrays like `throwResolvedValuesError([readResolvedValueForRender(..)])`;
  handler mutations of module source lists never notified readers).
- Root suite, batched: identical to baseline (2,882 pass, same 42 interference failures).
- Vite suite: NOT verified. The first run hit a full disk (a stale 4.4 GB `Temp/load.log`
  from an Oct 17 run, now deleted); the rerun was stopped by low memory. Baseline vite had
  3 slow end-to-end failures (likely timeouts). Rerun on a bigger machine.
- Watch: module `.map` lists now sit inside a pending site rather than an empty-list
  region; check `bench/` list numbers.
- Lesson: copying whole authored subtrees breaks plans keyed by node identity
  (group call policies, prepared list plans). Edit leaves in place wherever authored
  nodes must survive; copy only where code is moved into generated callbacks.

## Next

1. Vite suite and `bench/` on a machine with more memory.
2. Reactive refs: a ref assignment is a write to the ref binding (see `compileRefValue`).
3. Then the render plan (see `plan.md`).
