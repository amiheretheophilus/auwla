# Status

Last updated: 2026-10-26.

## Branches

- Repository: `amiheretheophilus/auwla` (remote `origin`), from 2026-10-19. Push
  only there. The old `snrraptopack/memo-exp` is remote `memo-exp`, with its push URL
  disabled. Its account has a billing lock, so CI cannot run there. See `../AGENTS.md`.
- `compiler-rewrite` (working branch, from `compiler-refactor` at `6230c27`):
  the new compiler, designed in `compiler/`. Phases 1–4, the Phase 5 general list
  rule, Phase 6 components/props and Phase 7 effects/cleanup/refs are built. Existing suites pass
  within their coverage, with later-phase failures explicitly diagnosed. The
  supplied `874c826` benchmark report passes correctness gates but fails the
  performance floor: old wins all 24 Octane operations, and the DOM update-style
  run ends in an OOM. Boundary fixes and their validation are below. Phase 5 fast
  paths and new VM measurements remain deferred release gates. The user paused
  performance work on 2026-10-26; continue feature correctness with Phase 8.
- `compiler-refactor`: the old compiler's refactor, stopped on 2026-10-19. The
  sections below record that work.
- `codex/package-conditional-sync` at `9e35480` (third-party package compilation,
  development inspector, authored JSX diagnostics) is merged in as `616348a`,
  without conflicts. Merged so that branch is not stranded by the refactor.
- The user put the agent in charge of the refactor on 2026-10-18 ("you are in charge now").

## Done

- Phase 8 graph foundation (2026-10-26): source-valued calls and visible helper
  returns are classified by binding identity, including aliases, named imports
  and re-exports. Changing request inputs preserves `Source`; a status-only
  `$track` dependency stays reactive without propagating a payload wait.
  Two new behavioral assertions caught and fixed reference guards waiting on
  a helper's status-only source capture. Existing assertions are unchanged.
  Local package type checking, 62 focused compiler checks and 148 source/
  lifecycle/ref/callback reference cases pass. Source emission, ownership,
  delayed computations and Group remain unfinished; the explicit Phase 8 guard
  remains in place. Performance is still paused.

- Phase 7 completed (2026-10-26, `4e15dc31`): effects, cleanup, module
  effects, loop/conditional/helper registrations and reactive refs are built on
  existing runtime ownership, collectors, write batches and ref mounting. Ref
  assignments reuse ordinary write/mutation emission; imported member roots and
  generic hosts are covered. Early-return paths dispose and reactivate effects.
  Effect execution locals retain that run's values, as the user explicitly chose;
  obsolete async cleanup runs immediately without replacing current teardown.
  The reference fixes retain the original assertions and independently cover
  loop occurrences, generated guard bindings and async cleanup generations.
  Local checks pass: 18 effect and 19 ref comparisons in both compiler modes,
  74 focused compiler/plan/benchmark checks total, 63 runtime checks and 64 existing
  lifecycle/ref integration checks. Both package type checks and the runtime
  build pass. No full root suite or timing benchmark was run.
  [CI 40355236792](https://github.com/amiheretheophilus/auwla/actions/runs/40355236792)
  passes all jobs at that commit: 305 compiler checks, 158 runtime checks, 358
  reference cases, 281 compiler comparisons and ten generator checks at
  `FC_RUNS=200`. The 77 remaining failures all explicitly name Phase 8; six cases
  combining lifecycle and sources now reach the source guard instead of Phase 7.
  No existing behavioral expectation was weakened. Next: Phase 8 sources and
  readiness, starting with `$read`/`$fetch` and the dependency/seed rules before
  Group publication and request lifecycle. Performance remains paused.

- Work order updated (2026-10-26): performance is paused at the user's request.
  Phase 7 effects, cleanup and reactive refs are next, followed by the remaining
  feature phases. Reuse existing runtime ownership and tracking, keep code readable
  and avoid duplicate implementations. The paused row-list step is preserved on
  `tmp/perf-rows` at `b5166fb7`; Phase 7 proceeds on `compiler-rewrite`. Outstanding
  performance and memory gates still apply before replacing the old compiler.

- Quick browser benchmark after routing (2026-10-26):
  [run 40324188637](https://github.com/amiheretheophilus/auwla/actions/runs/40324188637)
  passes at `50c92d29`, comparing old/next at the same snapshot with seven DOM
  samples per cell, three Octane samples and targeted profiles. Selection at
  10k is 0.1–0.2 ms across the framework placements. Module-component
  create/update/clear remain 32.7/5.5/2.3 ms next versus 19.4/1.6/0.8 old.
  Octane has eleven faster next medians, three ties and ten slower out of 24;
  `runlots` remains 107.5 versus 63.5 ms. Every timed DOM sample and Octane's
  harness/identity checks pass. Decoded profiles, guard limits, runner drift
  and the next text-fusion candidate are on `compiler/optimize.md`. Full reports
  and bundles are downloaded to ignored `bench/dom/dist/ci-40324188637/`.
  These quick results do not close the VM speed/memory gate or the prior OOM.

- Selection routing completed (2026-10-26, `a4a6b06e`): inline rows and leaf component rows
  now refresh old/new keys when only a proven strict key comparison changes.
  The unchanged Octane and four component-row benchmark fixtures each update
  1 row on first selection and 2 on changed selection, with zero key evaluation;
  a native 10k-row check verifies the same bound and no work on reselection.
  Fallbacks preserve other inputs, custom methods, ambiguous/accessor keys,
  recovery, dependency collection and disposal (`compiler/optimize.md`). A new
  mixed-key case also fixed reference siblings overwriting one another's props.
  Both package type checks, the runtime build, 113 focused compiler/benchmark/
  comparison checks and 40 runtime checks pass locally.
  [CI 40318873066](https://github.com/amiheretheophilus/auwla/actions/runs/40318873066)
  at `a4a6b06e` passes every job: 301 compiler checks, 150 runtime checks, 341
  reference cases, 241 compiler comparisons with the same 100 deferred failures
  (29 Phase 7, 71 Phase 8), and ten generator checks at `FC_RUNS=200`.
  No VM speedup or OOM resolution is claimed from these work counts. The routing
  and toolchain work is committed and pushed; the working tree is clean.

- Allocation-free write observation (2026-10-26, step 1 of the gap plan):
  - A store or delete reports its one object without building sets or arrays.
  - Shared roots are visited without a generator.
  - A primitive value adds nothing to a reach.
  - String, symbol and number keys skip the computed-key probe; other keys still
    convert once, through it (new runtime test).

  Notifications, stamps and alias records are unchanged.
  [ABBA run 40332528139](https://github.com/amiheretheophilus/auwla/actions/runs/40332528139)
  (same compiler, nine samples, both orders) improves update 10k in all eight
  placements, for example module-component 5.5 → 3.4 and 4.2 → 3.5 ms, and
  owner-inline 3.5 → 2.6 and 3.4 → 2.5 ms. Create and clear are unchanged
  within noise. Runtime mutation/method/row-list tests (64) and 173 compiler
  handler, list, optimize and benchmark checks pass locally.

- Gap analysis against the old compiler (2026-10-26): hand-edited variants of
  the module-component output, timed interleaved with a forced GC per sample.
  These attribute the gaps (`compiler/optimize.md`, "Gap analysis"):
  - **Update** (old 5 ms, next 20–24 locally): about 9 ms is per-write
    observation, 2 ms the routing proof, and the rest per-pass allocation.
  - **Create** (old 73–82, next 152): fused text, delegation and `className`
    bring next to 96–101.
  - **Clear:** per-row teardown JS.

  Next steps, in order:
  1. Allocation-free write observation.
  2. Row-list buffers, a cached routing proof, and a bulk clear.
  3. Guarded text fusion.
  4. Per-row objects.
  5. A shared native listener per list instead of a wrapper per row.
     Delegation is rejected for correctness (`decisions.md`).

  Every optimization keeps its general path. Phases 7/8 remain deferred.

- Bun development types (2026-10-26, `21aed36f`): completed the pending `@types/bun`
  update from `latest` to `^1.4.4`, with matching 1.4.4 lockfile resolutions.
  The frozen install makes no changes, and compiler-next (139 files) and
  runtime (76 files) pass `bun check` (`compiler/toolchain.md`).

- Helper method/prototype correctness gate (2026-10-26, `0f072957`): explicit member stores
  and native method calls on the same fresh array keep observation, since entry
  guards cannot establish that a later call still reaches the native method.
  Prototype stores stay observed, and computed store parameters are checked for
  `__proto__` as well as primitive type. Locally concatenated prototype keys also
  keep observation. Six new reference comparisons first failed on optimized
  output and now pass in both compiler modes (`compiler/optimize.md`). Both
  package type checks, the runtime build, 56 focused compiler/handler/benchmark
  checks and 18 runtime method-call checks pass locally.
  [CI 40311997300](https://github.com/amiheretheophilus/auwla/actions/runs/40311997300)
  at `0f072957` passes every job: 281 compiler checks, 138 runtime checks, 336
  reference cases, 236 compiler comparisons with the unchanged 100 deferred
  failures (29 Phase 7, 71 Phase 8), and ten generator checks at `FC_RUNS=200`.
  Routing/toolchain work was deferred from this fix and is completed above; no
  timing improvement or OOM resolution is claimed for the helper fix.

- Fresh-allocation correctness gate (2026-10-26, `7edc5540`): helper proofs retain
  observation for object accessors and custom prototypes, and require primitive
  computed store/object-literal keys. The pre-fix optimized output missed edits
  from own/inherited setters, an own getter, object/array store-key conversion,
  and a setter that edited before throwing. Reference comparisons cover those
  effects and computed literal keys. Primitive numeric loop indices still
  qualify (`compiler/optimize.md`). The package type check and 37 focused
  helper, handler and benchmark integration checks pass locally; benchmark
  checks verify row text, identity, selection and disposal without timing.

- Catalog fallback gate (2026-10-26, `6e97a597`): an unlisted, dynamically
  installed array method is accepted directly and through a helper, and its edits match the
  reference in both compiler modes. A native method reached through an unlisted
  alias is proven by function identity, never rejected by its property name.
  The shared catalog's compiler capability is named `helperProof` to distinguish
  it from permission to call an authored method (`compiler/optimize.md`). The
  package type check, runtime build, 16 focused compiler checks and 17 native
  method-call checks pass locally.

- Shared array-method facts (2026-10-26): the compiler and runtime now consume
  one immutable, data-only catalog (`runtime/src/array-methods.ts`), exported
  through `@memoized-dom/runtime/array-methods`. This removes the duplicate
  compiler copy/read/edit, callback, conversion and primitive-result tables and
  the runtime's separate intrinsic registration list. The compiler still proves
  authored effects, and the runtime still checks actual callee identity; method
  names do not establish semantics (`compiler/optimize.md`). The earlier helper
  correctness fix is committed and pushed as `babb31b6`. Both package type
  checks, the runtime build, 29 compiler/handler checks and 16 native method-call
  checks pass locally. [CI 40307783732](https://github.com/amiheretheophilus/auwla/actions/runs/40307783732)
  at `42ca548e` passes every job: 279 compiler checks, 136 runtime checks, 322
  reference cases, 222 compiler comparisons with the unchanged 100 deferred
  failures (29 Phase 7, 71 Phase 8), and ten generator checks at `FC_RUNS=200`.

- Helper correctness gate (2026-10-26): the supplied review is audited on
  `compiler/optimize.md`, and correctness fixes precede further performance
  changes (`decisions.md`). Named array callbacks stay observed unless their
  executed body is proven; helper parameters used as native indices are checked
  as primitive before skipping observation. The new handler cases fail on the
  previous optimized output and pass on the reference and both compiler modes
  after the fix. Runtime checks also preserve edits before a coercion throws.
  Local validation: both type checks, 20 compiler/handler checks and 16 native
  method-call checks pass. The current selection-routing work and toolchain
  edits are unrelated and remain outside this change. Full CI follows the push;
  no performance or OOM resolution is claimed.

- Component roots skip their own edits (2026-10-26): an edit through a
  component's state binding no longer walks that binding's root, as for shared
  roots (`compiler/handlers.md`). At `a3427110` the owner placements still took
  ~20 ms for update/swap/remove 10k against ~2 ms old.
  [Quick run 40298575648](https://github.com/amiheretheophilus/auwla/actions/runs/40298575648)
  at `a3427110`: Octane next is at or under old on 12 of 24 operations (remove,
  reverse, rotatef/b, prepend100, append100, removefirst, displace3–8);
  runlots 68.7 against 51.8 ms, select_lots 1.9 against 0.1.

- Leaf rows with handler edits (2026-10-26): a row component whose handlers edit
  its props (`props.select(id)`) is compiled into the row list too; the edit
  stays observed and re-renders the list (`compiler/optimize.md`, "Row lists").
  The owner and module-data component placements now use row lists. A both-mode
  check edits a row's item through its props and through a prop method's `this`.

- Read-only helpers (2026-10-26, `decisions.md`): a call of a helper proven to
  edit only what it allocates skips the whole-input snapshot once the runtime
  proves the array methods it assumed (`compiler/optimize.md`, "Read-only
  helpers"). Octane's `updateRows`, `swapRows` and `removeRow` qualify.

- Old-model fast paths, step 5 (2026-10-26): templates built once and cloned.
  Every component, branch, stored JSX value and row now clones a template built
  with DOM calls once per document (`compiler/core.md`), reaching nodes through
  `firstChild`/`nextSibling`; a row list inserts runs of new or moved rows as one
  fragment. The creation profile no longer shows `replaceWith`, the clone walk,
  per-row `createTextNode` or markup lookup, which were about half of creation.
  Hydration and server documents keep the general creation (runtime
  `markup.test.ts`). Both type checks, 270 compiler and 133 runtime tests, the
  case files (unchanged 100 deferred failures) and the Chrome gates pass. Prompted
  by a second outside review, whose other points (read-only helpers, targeted
  list refreshes, rows whose handlers call `props.select`, delegated events)
  are the next steps.

- Old-model fast paths, step 4 (2026-10-26): row matching without rebuilding.
  A row list keeps its identity index across passes and matches the rows next
  to the last match before looking up, so a swap, a removal, an insertion or a
  reversal of 10k rows no longer builds a 10k-entry lookup with a key string per
  row, nor a duplicate set. Same reuse, creation and disposal order as the
  general path: the model checks now include 60 random 20-step sequences per
  mode on one list. Locally, inline reverse and remove100 at 10k are at or under
  old. Both type checks, 270 compiler and 131 runtime tests, the case files
  (unchanged 100 deferred failures) and the Chrome gates pass.
  [Quick run 40290911237](https://github.com/amiheretheophilus/auwla/actions/runs/40290911237)
  and [CI 40290905464](https://github.com/amiheretheophilus/auwla/actions/runs/40290905464)
  pass at `289dd9dd`. Module rows now match or beat old on swap and remove 10k
  (component 2.3/2.1 against 2.6/2.2 ms; inline 1.9/1.6 against 2.0/1.8). Octane
  beats old on 10 of 24 operations (reverse, rotatef/b, removefirst,
  removeevery10, displace3–8). Still behind: creation about 3× (Octane runlots
  146 against 64 ms), update 5×, selection, and the owner and module-data
  component placements, whose rows are not leaves yet.
  [Quick run 40289536569](https://github.com/amiheretheophilus/auwla/actions/runs/40289536569)
  at step 3 (`403d9e19`): module-component 10k create/update/clear 54/6.7/1.7 ms
  (step 2: 129/24/27.5; old 19/1.3/0.8). Octane swap 5.5, runlots 149 (old 67).
  [CI 40289531456](https://github.com/amiheretheophilus/auwla/actions/runs/40289531456) passes.

- Old-model fast paths, step 3 (2026-10-26): leaf component rows. A row list's
  row can be `<Row key={…} … />` for a component whose instance only shows its
  props; its template is compiled once more as a module-level row factory
  (`compiler/optimize.md`, "Row lists"). No entity, write batch, build scope,
  props cell or computation per row. Both-mode DOM traces match the general
  path's node identity for keyed and unkeyed component rows, and the props
  object stays the same while its fields do. Locally, module-component 10k
  create/update/clear went from 684/161/90 ms to 425/69/11 ms (old 175/10/4).
  Rows calling `props.select(…)` are not leaves (the call is observed as an edit
  of `props`), so the owner and module-data placements are still general.
  [Quick run 40245549997](https://github.com/amiheretheophilus/auwla/actions/runs/40245549997)
  at step 2 (`cd041270`): module-inline 10k update 4.7 ms (was 27), clear 1.5
  (was 15), pop1k 1.5 against old 2.2; Octane runlots 144 ms (was 303, old 64),
  swap 4.1 (was 11.8), rotatef 0.32 (was 2.8), prepend100 1.5 (was 13.1).
  [CI 40245546170](https://github.com/amiheretheophilus/auwla/actions/runs/40245546170) passes.

- Old-model fast paths, step 2 (2026-10-25): row lists and cheaper shared reads.
  A text site whose whole value is a proven `map` returning one keyed-first
  element is shown by compiled rows reconciled from the array (`compiler/optimize.md`,
  "Row lists"): no render value, capture array, nested slot or listener swap per
  row, LIS moves, one-call clearing. Its identity and order equal the general
  path's: a runtime model check covers every two-step sequence of up to three keys
  (14,450 transitions), and both-mode DOM traces compare node identity through
  moves, duplicates, holes, `'1'`/`1` keys, `reverse`, `splice` and edits. Shared
  owners refresh once per write instead of once per read (`write-epoch.ts`),
  readers reuse one version function, repeated tracked reads allocate nothing, and
  an edit through a shared binding no longer walks that binding's 10k items
  (`handlers.md`). Locally (slow desktop, three samples) module-inline 10k went
  from create/update/clear 328/135/10 ms to 236/27/9 ms against old 115/10/4 ms;
  component rows are unchanged until light row components land. Both type checks,
  265 compiler unit/native tests, 126 runtime tests, the case files (220 pass,
  the same 100 deferred failures) and the Chrome gates pass.

- Old-model fast paths, step 1 (2026-10-25, `decisions.md`): a text site not
  proven primitive creates its value slot on the first object value and writes
  text directly until then. A component row's `{props.item.id}` and
  `{props.item.label}` no longer allocate two slots per row. A native regression
  moves one site through text, stored JSX, an array, a number, null and a symbol
  description. Both type checks, 253 compiler unit/native tests, 118 runtime
  tests, the case files (220 pass, the unchanged 100 deferred failures) and the
  Chrome gates (all placements, all 16 update styles) pass. Next: the keyed
  `map` list region with compiled row updates.

- Compiler-next snapshot comparison (2026-10-25). The DOM runner now accepts
  `--before-compiler=next` and pairs each compiler snapshot with its runtime.
  `bench-quick.yml` exposes this through `compiler_ref`. Local validation against
  `12f687b3` passes every scenario and mixed sequence on both snapshots, with
  **identical browser hashes** and no timed samples or report writes. The CLI's
  `--validate-only` output is kept separate from timing artifacts.

- Ordered row matching (2026-10-25). The controlled retained-table result below
  regressed creation, so matching now consumes the unchanged ordered prefix
  directly and builds a temporary lookup only after its first mismatch. Creation,
  append, truncation and unchanged mappings need no matching map or per-item
  generation bookkeeping. A linear model checks all 3,375 three-step binary-item
  sequences with index use both enabled and disabled; duplicate/hole, reentry,
  exception and retention regressions remain. Both type checks, 33 focused
  runtime checks and 72 compiled feature/comparison checks pass. Chrome passes
  all placement/identity/mixed gates and all 16 mutable/immutable variants.
  Shared-code CI and a controlled comparison against `331ea92a` follow before
  accepting a timing benefit.
  [CI 40240409464](https://github.com/amiheretheophilus/auwla/actions/runs/40240409464)
  at `12f687b3` passes every job. The controlled timing run is `40240414329`.

- Notification GC verification (2026-10-25).
  [Unit CI 40239785266](https://github.com/amiheretheophilus/auwla/actions/runs/40239785266)
  at `922ee4d1` passes the unchanged payload release assertion and the queued
  strong-reference control. All 252 compiler checks and 116 runtime checks pass.
  The fixture collects and probes in fresh timer tasks, avoiding conservative
  roots from warm awaiting frames; no runtime workaround or version pin was
  needed. Temporary heap diagnostics are removed. This closes that CI failure,
  not the reported VM OOM.

- Retained map-result lookup trial (2026-10-25, superseded by ordered matching).
  `dedfdb38` removed replacement matching maps, but
  [ABBA run 40237496644](https://github.com/amiheretheophilus/auwla/actions/runs/40237496644)
  passes all correctness gates and does not justify the extra bookkeeping:
  creation regresses in most placements, updates are mixed, and clear improves
  modestly. The allocation count alone does not establish a speed improvement.
  Its duplicate, reentry, throw and retention regressions remain in the new
  matcher. The notification GC fixture failure from its CI is resolved above;
  no runtime workaround was kept. The ignored raw artifacts are under
  `bench/dom/dist/retained-map-comparison/`.

- Receiver-edit alias correction (2026-10-25). Native `reverse` could move an
  accessor/inherited value into an own data element while an already cached
  reach missed that new alias. The optimized compiled UI stayed at `10` after
  the object changed to `11`, while general mode correctly updated. Reaches now
  record accessors/holes and rebuild conservatively after such receiver edits.
  Proven insertions also record only actual inserted values, rather than the
  temporary arguments array or comparator. Four native regressions include
  partial-throw recovery and getter-call counts; the DOM regression passes in
  both modes. Both type checks, 47 focused runtime checks, 36 compiled
  native/fixture/comparison checks and all eight placement/16 update-style Chrome
  gates pass. The general fallback and existing proxy-reflection limits remain.
  [CI 40235925144](https://github.com/amiheretheophilus/auwla/actions/runs/40235925144)
  at `331ea92a` passes all four jobs: 252 compiler unit/native tests, 109 runtime
  tests, 320 reference cases, 220 compiler comparisons with the same 100 Phase
  7/8 failures, and ten generator/corpus checks at `FC_RUNS=200`.

- Shared mutation-cache lifetime (2026-10-25). A shared write now releases cached
  reaches whose native binding identity changed. Lazy shared derivations check
  again after replay, so a completed render does not retain their previous graph
  until some later mutation. The native reassignment GC check and both-mode
  compiled refresh GC checks fail before the fix and pass after it. An unchanged
  binding check does no data reflection and invokes no unused getter. Both type
  checks, 26 runtime lifecycle/mutation/retention checks and 87 focused compiled
  native/fixture/comparison checks pass. Chrome gates pass all eight compiled
  placements and all 16 update styles, with retained identity and mixed sequences.
  This fixes two reproduced lifetimes; the VM OOM remains unverified.
  [CI 40234242114](https://github.com/amiheretheophilus/auwla/actions/runs/40234242114)
  at `951aad5b` passes all four jobs: 250 compiler unit/native tests, 105 runtime
  tests, 320 reference cases, 220 compiler comparisons with the same 100 Phase
  7/8 failures, and ten generator/corpus checks at `FC_RUNS=200`.
  [Quick run 40234242313](https://github.com/amiheretheophilus/auwla/actions/runs/40234242313)
  passes DOM/Octane gates but still misses the floor: module-component
  create/update/clear 10k are 144.7/50.5/34.2 ms next versus 18.9/2.0/0.8 ms old
  (seven samples). Octane runlots is 293.6 versus 63.4 ms (three samples), and all
  24 operations remain slower. These columns compare current compilers within
  one run; separate-run numbers do not isolate either lifetime fix. The clear
  profile shows individual DOM removals and GC as major costs. The ignored local
  artifact copy is `bench/dom/dist/shared-cache-audit/`.

- Mutation-index ownership cleanup (2026-10-25). Indexed roots now detach their
  memberships on disposal and reindexing. Completed updates release changed or
  stale graphs before rebuilding lazily, and failed reflection leaves a retry
  pending. Eight native regressions cover repeated mount/dispose, binding
  replacement, retained aliases, opaque edits, stale reaches, interrupted walks
  and disposal during a proxy trap. The 200-cycle check leaves **zero dead
  memberships instead of 200**. Focused runtime checks, both type checks,
  37 compiled native/fixture tests and 34 both-mode comparison cases pass.
  Chrome correctness gates pass all eight compiled placements and all 16 update
  variants, including retained identity and mixed sequences. The shared-cache
  batch above also fixes retention of a shared binding's previous data.
  Neither finding establishes the VM OOM's
  cause or resolution.
  [CI 40233278523](https://github.com/amiheretheophilus/auwla/actions/runs/40233278523)
  at `7bd641e0` passes all four jobs: 248 compiler unit/native tests, 103 runtime
  tests, 320 reference cases, 220 compiler comparisons with the unchanged 100
  Phase 7/8 failures, and ten generator/corpus checks at `FC_RUNS=200`.

- Controlled write-batch measurement (2026-10-25).
  [Run 40231260866](https://github.com/amiheretheophilus/auwla/actions/runs/40231260866)
  compares `d5abe1f0` with `248f8a83` using identical compiler-next output, seven
  samples per cell and before/after/after/before order. All placement, identity
  and mixed-sequence gates pass in all four passes. Component-row update 10k
  improves in both orders: module-component **57.2 to 28.2 ms**, then **75.2 to
  52.8 ms**; owner-component **69.3 to 36.7 ms**, then **85.6 to 52.7 ms**;
  module-data component **60.2 to 39.4 ms**, then **78.2 to 51.6 ms**. Component
  creation is lower in both orders, but other cells show substantial runner
  drift, including vanilla. Clearing is mixed: module-component is 39.6 to
  42.6 ms, then 60.9 to 50.7 ms; owner-inline updates also disagree by order.
  The evidence supports the component-update benefit; it does not establish a
  general clearing or inline-row improvement.
  The same-run old/next check still has a large gap: module-component create,
  update and clear are **21.8/1.6/0.9 ms** old against **175.9/50.2/41.5 ms** next.
  Octane passes its harness and retained-identity gates but remains slower on
  all 24 operations (runlots **326.9 vs 83.0 ms**). The update profile still shows
  mutation reachability walks, `mutatedSince`, row mapping/reconciliation and GC;
  creation still pays row setup and DOM work. Full-list scans, capture packing
  and the VM OOM remain open. Raw samples and bundle hashes are in the
  `bench-quick` artifact at `bench/dom/dist/compare/d5abe1f0-runtime/results.json`;
  the report's dirty-tree flag contains only generated `quick.md` and
  `profiles.md`. A local ignored copy is under
  `bench/dom/dist/write-batch-comparison/`.

- Bounded write-batch recovery and grouped commits (2026-10-25). The native
  200-row listener check now uses **one kernel commit and one queued recovery**,
  rather than 200 commits and 201 callbacks, while rendering all 200 rows.
  Completed row data can be collected while recovery is still queued. Parent
  marks of already queued children are acknowledged at actual render start;
  later writes still run. Focused checks cover explicit renders, cross-application
  order, observer/render errors, extracted methods and propagation in the same
  boundary. Local type checks, 60 runtime/kernel/ownership checks, 40 compiled
  native checks, two both-mode callback-budget checks and 34 comparison cases
  pass. Chrome correctness gates pass all eight compiled state placements and
  all 16 mutable/immutable update variants, including retained DOM identity and
  mixed sequences.
  [CI 40231249500](https://github.com/amiheretheophilus/auwla/actions/runs/40231249500)
  at `248f8a83` passes all four jobs: **248 compiler unit/native tests**, **95
  runtime tests**, **320 reference cases**, **220 compiler comparisons** in both
  modes with the unchanged **100 deferred failures** (29 Phase 7, 71 Phase 8),
  and all ten generator/corpus checks at `FC_RUNS=200`. The controlled measurement
  above closes this implementation step; the Phase 5 performance floor remains
  unmet.

- Isolated ownership measurement (2026-10-25).
  [ABBA run 40220315808](https://github.com/amiheretheophilus/auwla/actions/runs/40220315808)
  compares the runtime before ownership changes (`4fde956e`) with the changed
  runtime, using identical current compiler output, seven samples per cell,
  deterministic inputs and all placement/identity gates. Owner-component clear
  10k improves in both orders: **33.5 to 26.0 ms**, then **29.4 to 25.5 ms**.
  Module-data component clear is **33.8 to 27.8 ms**, then **28.1 to 27.2 ms**.
  Creation is mixed, and module-component clear has a slower first-order result
  (37.9 to 50.8 ms) followed by 34.6 to 33.7 ms. The evidence supports the
  deterministic registration reduction and a limited clearing benefit, not a
  broad creation win or the Phase 5 floor. The report's dirty-tree flag is only
  the generated `quick.md`; raw status and bundle hashes are in its artifact.
  Next work remains row setup/teardown costs, full-list scans and capture
  allocations. Capture packing and the reported VM OOM remain unresolved.

- Shared-code audit at `8ede65b2` (2026-10-25).
  [CI 40219352965](https://github.com/amiheretheophilus/auwla/actions/runs/40219352965)
  passes all four jobs: **246 compiler unit/native tests**, **82 runtime tests**,
  **320 reference cases**, **220 compiler comparisons** in both modes with the
  unchanged **100 deferred failures** (29 Phase 7, 71 Phase 8), and all ten
  generator/corpus checks at `FC_RUNS=200`.
  [Quick timing 40219352792](https://github.com/amiheretheophilus/auwla/actions/runs/40219352792)
  passes DOM/Octane gates, but next is still slower than old: module-component
  create/clear 10k are 163.4/31.4 ms versus 21.1/0.9 ms (five samples); Octane
  runlots is 405.9 versus 61.7 ms (three samples). Separate-run timing changes
  do not prove a regression or win from the ownership change. `bench-quick.yml`
  now accepts `runtime_ref` to run the existing same-compiler ABBA create/clear
  comparison and retain its raw samples, so that change can be isolated.

- Lazy computation ownership (2026-10-25). Profiling row creation and clearing
  at `bd89c47c` confirmed allocation/GC, lifecycle and DOM removal costs
  ([run 40217588825](https://github.com/amiheretheophilus/auwla/actions/runs/40217588825)).
  Empty collectors now avoid disposal registration until their first actual
  subscription. The unchanged 1,000-row module-data component fixture adds
  **0 ownership entries instead of 3,000**, in both compiler modes; later
  subscriptions still belong to their creating application. A shared weak
  registry handle prevents a retained empty collector from keeping application
  storage alive. The first draft's strong handle failed the new GC regression;
  the weak version passes it unchanged. Local checks pass both type checks,
  28 lifecycle/retention tests and 44 compiler/native/fixture tests. Chrome
  correctness gates pass all eight compiled state placements and all 16
  mutable/immutable update styles, including identity and mixed sequences.
  Four tracked inline fixtures reflect the corrected key capture layout.
  Broad CI and runner timings follow after this commit.
  This removes one fixed row cost; it does not eliminate computation objects,
  per-row batches, props cells, DOM work or full-list scans.

- Row-reuse boundary audit (2026-10-25). Three newly failing runtime checks
  reproduced signed-zero conflation, non-native proxy length conversion and a
  species proof invalidated during argument evaluation. Reuse now confirms
  candidates with `Object.is`, shares native length conversion with child
  traversal, and rechecks species after arguments. A native DOM regression
  fails only with optimizations before the fix and passes in both modes after
  it. Both type checks, 32 focused runtime checks and 14 compiler/native checks
  pass. These fixes preserve the opaque fallback and add no method-name rule.

- Capture-order audit (2026-10-25). The eight pending native regressions now
  pass in both modes: stored keys run at their attribute position, the final
  duplicate key controls identity, a throwing key prevents later evaluation,
  and an overridden explicit `children` expression still runs. Keys are ordered
  capture sites; their final root capture supplies identity without a second
  evaluation. Explicit host children use the existing ordered props path.
  Both type checks, 25 focused planner/native checks and 74 component/list
  comparisons pass. Capture packing
  remains unimplemented; no allocation or speed claim accompanies this fix.

- Row reuse and keyed selection for component state (2026-10-25). Component
  bindings read in a row callback are already tracked reads, so row reuse accepts
  them, and `x === e` at such a read is keyed. Every bench variant and Octane's
  rows qualify. Compiler tests: 234 pass (the 8 failures are the untracked
  `packed-captures` work). Cases: 220 pass, with the same 100 deferred failures.
  DOM gates pass. `bench-quick.yml` can also run Octane `--quick` for
  memoized-dom, old against next (`-f octane=true`).
  - GitHub quick timing at `7df981a4`, next against old at 10k, in ms:
    component-row remove 15 vs 2.4; inline-row update 28 vs 1.0, select 12 vs 0.2.

- Row reuse for `items.map` (2026-10-25). An unchanged item no longer re-runs
  the callback or re-checks its row, when the callback is proven to allow it
  (`compiler/optimize.md`, "Row reuse").
  - Applies to the module-state bench variants. Callbacks reading component
    state or props keep the general path until component reads are tracked
    per row.
  - Bug found by the DOM gates and fixed here. `share()` copied each keyed
    dependency under its key, so several rows' `selected === id` collapsed to
    the last one, and `module-inline` select 1k failed. Keyed reads of
    different values now merge into a plain dependency (`depend` in
    `runtime/src/computation.ts`). The same overwrite could already miss a
    change in `807c0f8b`, through an opaque guarded statement's hidden reads.
    Regression tests are in `computation.test.ts` and `row-reuse.dom.test.ts`.
  - Cases: 220 pass, with the same 100 deferred failures. Runtime tests pass
    (75). Compiler tests pass, apart from the untracked `packed-captures` work
    in progress. The DOM gates pass: all 8 state placements and 16 update styles.
  - GitHub quick timing at `807c0f8b` (before this change), next vs old in ms
    at 10k, component rows: select 1.2 vs 0.2, update 61 vs 1.4, remove 53 vs 2.6.

- Targeted selection for component rows (2026-10-25). `optimize/keyed-comparisons.ts`
  plus the runtime's `trackEquals`: a selection wakes the rows whose
  `selected === id` can flip, not every row (`compiler/optimize.md`, "Keyed
  comparisons").
  - GitHub quick timing at `634fcd59`, before this change, next against old in
    ms at 10k: component-row select 58 vs 0.2, update 75 vs 1.7, remove 62 vs 2.6.
  - Every list operation still costs 15–90 ms, because each change re-runs the
    whole `map` and reconciles all rows. Per-item reuse in lists is next.
  - Cases: 220 pass, with the same 100 deferred failures. Compiler unit tests
    pass, apart from the untracked `packed-captures` work in progress. All 9
    computation tests pass.

- Per-row costs found by profiling (2026-10-25). `bench/dom/quick.ts` times
  chosen DOM scenarios, old against next, without a full run. On GitHub the same
  runs through `bench-quick.yml`, which can also CPU-profile a scenario
  (`bench/dom/profile.ts`). The desktop is too noisy for close comparisons.
  - Store alias lookup: every store visited every mounted component's root entry,
    and each component row registered one, even an empty one. It is now an object
    index, with re-checks after a component updates (`compiler/handlers.md`).
    Update 10k with component rows dropped from 3.5 s to about 0.3 s locally.
  - Computations are a class whose maps are created on first use. Each component
    row creates three, and most track nothing.
  - All runtime tests pass, and so do the compiler unit/DOM tests (apart from the
    untracked `packed-captures` work in progress). Every case file matches the
    100 deferred failures. Under full-suite load on the desktop, seven
    two-strategy cases exceed the 5 s timeout; they pass when rerun alone.

- Method-call observation proof (2026-10-25). Review of the `874c826` report found
  the main cost: every observed call snapshots all the data it reaches. That was
  about 70 ms per call on 10k rows, including the `data.map(...)` render site that
  runs on every list update (select, update). `optimize/methods.ts` lowers member
  calls to `observeMethod`. `runtime/src/method-calls.ts` skips the snapshot when
  the actual callee is a captured array intrinsic and its receiver, arguments and
  callbacks satisfy the proof (`compiler/optimize.md`, "Method calls").
  - Micro timings on 10k rows: `slice` 84 → 0.11 ms, `map` 68 → 0.47 ms,
    `reverse` 82 → 0.03 ms.
  - Every observation in the compiled DOM component app is now lowered and
    provable at runtime: concat, slice, filter, map, reverse and splice.
  - Octane's calls into compiled helpers (`updateRows`, `swapRows`, `removeRow`,
    `shuffleRows`) stay observed (`decisions.md`).
  - Local validation: both type checks; 8 runtime method-call tests plus 10
    mutation tests; 59 compiler unit and DOM checks in both modes.
  - The eight case files that use array methods give 177 pass and the same 93
    deferred failures as without the change (identical list).
  - DOM bench gates pass on compiler-next: state-placement validation and all 16
    update-style variants.
  - VM timings are pending.

- First list optimization (2026-10-25, `84b52062`).
  `optimize/retained-list-index.ts` selects private row-index retention on fresh
  plans; the authored expressions, calls, graph identities and opaque observation
  remain intact. The runtime cache follows first-unused identity matching,
  disposes unmatched primary rows before old duplicates, and detaches before
  getters/key coercion/cleanup so exceptions or reentry cannot reuse a partial
  index. Local matcher work counts are one map for 30 updates versus 30 general
  maps; four selections in the unchanged 1,000-row inline fixture build zero new
  matching maps with the pass versus four without it. Native custom-method and
  callback checks pass in both modes. These are work counts, not speed/memory
  results. Iteration lowering, capture removal, snapshot proofs, listener work
  and targeted selection remain pending before the Phase 5/VM gate.
  Local validation passes both package type checks (126 compiler and 71 runtime
  source files), 84 focused compiler/behavior checks, 19 runtime/retention checks
  including all 3,375 tested three-step key sequences, and 12 generated programs
  (four component, four namespace and four conditional programs; seed 20261025)
  through both strategies.
  Manual CI [40186447841](https://github.com/amiheretheophilus/auwla/actions/runs/40186447841)
  passes all four jobs: **220 compiler-next cases** through both strategies,
  with the same **100 deferred failures** (**29 Phase 7**, **71 Phase 8**);
  **320 reference cases**, **218 compiler unit tests**, **57 runtime tests**,
  and all ten generator/corpus checks at `FC_RUNS=200`. Compiler-comparison
  generators exercise both strategies; the source/readiness generator keeps its
  existing reference-only baseline. No VM speed or OOM conclusion follows.

- Array-child traversal corrected before the first list pass (2026-10-25, `af93949f`).
  Three new native checks reproduced a sparse-array crash, duplicate reads of
  indexed getters, and accidental invocation of an authored array's `map` method.
  General traversal now uses native length/index semantics, preserves source
  positions across holes, and stores each child value once for its later write.
  Row matching lives in `runtime/src/list-values.ts`; the reference is unchanged.
  Local validation passes both package type checks, all nine runtime value tests,
  53 conditional/list comparisons with both strategies, and all six unchanged
  benchmark-fixture correctness/work checks. No timing improvement is claimed.

- Optimization stage and comparison switch (2026-10-25, `bb3bd733`). `pipeline.ts`
  calls `optimize/index.ts` between the general planner and emission.
  `optimize: false` bypasses the passes. The harness runs compiler-next
  with passes on and off for each comparison/generated program, saving the
  general output in `next-general/` and checking it against both the reference
  and default output. Local validation passes `bun check` (123 files), four
  pipeline tests and all 21 component comparisons through both strategies.
  The first list pass above uses this boundary.

- Optimization plan clarified (2026-10-25). `compiler/optimize.md` records the
  folder boundaries and implementation order: establish emitted work, add the
  plan-stage/on-off boundary, then one proven list pass before further passes.
  Removed the unsafe claim that names such as `map` justify skipping mutation
  observation; even native callbacks/accessors can mutate state. Unknown and
  overridden calls keep the general path. This is a documentation correction,
  not an implemented optimization or a performance result.

- Boundary audit after the `874c826` benchmark report (2026-10-25, `e995061a`). Independent
  native checks exposed failed-mount entity/collector leaks, stale earlier reads
  after child setup writes, skipped symbol-only props and changed rest-key order,
  and incorrect namespaces for custom markup consumed in SVG. Setup now registers
  its inactive entity before owned work and disposes abandoned subtrees through
  existing build-scope recovery. Rendering remembers writes until all sites are
  ready, then activation settles them. Props compare ordered enumerable own keys,
  including symbols; markup follows its consuming namespace without a tag table.
  Retention checks also found finished mutation observations and notification waves
  held payloads until queued recovery. Completed work now releases those payloads
  and queues at most one recovery of each kind per application turn; abandoned
  calls retain their first recovery so partial edits still notify. Recovery runs
  in its originating application. These fixes do not establish the cause or
  resolution of the reported OOM, and no speed improvement is claimed. Local
  validation passes both package type checks, 21 component comparisons, 45 native
  compiler/benchmark/recovery tests, 42 runtime tests and 16 generated programs
  (eight component combinations and eight namespace combinations, seed 20261025).
  Manual CI [40183522441](https://github.com/amiheretheophilus/auwla/actions/runs/40183522441)
  passes all four jobs at `e995061a`: **218 compiler-next cases**, with the same
  **100 deferred failures** (**29 Phase 7**, **71 Phase 8**); **318 reference
  cases**, **210 compiler unit tests**, **48 runtime tests**, and all ten
  generator/corpus checks with `FC_RUNS=200`, including 200 component combinations
  and 200 namespace combinations. This establishes the tested contracts, not
  universal correctness or the performance floor.

- Phase 6 review fixes (2026-10-25, `42ec7c07` and the benchmark commit after
  it). A child component updates only when a prop changed or a compiled edit
  reached it; a shared write wakes only readers of what it wrote and of derived
  values. Its SVG tag restriction is superseded by the boundary audit above.
  On the component-row app,
  editing 100 labels now runs 101 updates instead of 1,001, and a swap, removal or
  append runs 1 instead of about 1,000 (`features/components/bench.test.ts`). CI
  [40168517752](https://github.com/amiheretheophilus/auwla/actions/runs/40168517752)
  passes all four jobs: 217 compiler-next cases (100 Phase 7/8 failures), 317
  reference cases, unit/runtime tests and all generators at 200 programs.
  Running the DOM suite's gates on compiler-next found that a name inside a
  prop's type (`(id: number) => void`) was treated as a prop; fixed in
  `isRuntimeBinding`. All four component-row DOM apps are now mounted by
  `bench.test.ts`. `bun run bench:vm` runs the DOM suite (against vanilla JS) and
  Octane with compiler-next in one command; compiler-next's output is kept apart
  (`compiled-*.next.ts`, `octane/memoized-dom/dist.next/`).

- Phase 6 general component/props integration (2026-10-24, `58a130a8`).
  Ordered call values cover named/member/dynamic/native tags, factories,
  recursive components, children, spread props and keyed identity. Parameter
  bindings receive versions and independent parent snapshots, preserving local
  prop overrides. Direct-call adapters retain all arguments and native defaults/
  rest; discarded calls run setup without mounting output. Native checks found
  and fixed reserved-prop leakage, inherited SVG/foreignObject handling, lost
  module tag reads and delayed child batch commits. Local cross-owner reads now
  notify their consumers. The reference retains nested setup function identity.
  Local verification: **84 component/state comparisons, nine native component
  tests, 22 affected runtime tests and ten generated component programs pass**.
  Compiler-next and runtime type checks pass. Manual CI audit
  [40128972595](https://github.com/amiheretheophilus/auwla/actions/runs/40128972595)
  passes: **217 compiler-next cases**, with all **100 failures** belonging to
  later phases (**29 Phase 7**, **71 Phase 8**); **317 reference cases**, **195
  compiler unit tests**, **37 runtime tests**, and the full generator/corpus
  batch with `FC_RUNS=200`, including 200 new component combinations.
  A follow-up real-entry check adds root-factory registration for authored
  `mount`, one native root test and two checks against the unchanged Octane/DOM
  benchmark apps. The latter verify 1,000-row correctness and identity using the
  test DOM, not browser timings. Octane now accepts an explicit compiler source
  entry; the user can measure the rewrite rather than the old default compiler.
  The follow-up is `5ca4cdec`; final audit
  [40129337301](https://github.com/amiheretheophilus/auwla/actions/runs/40129337301)
  passes all four jobs: **217 compiler-next cases**, the same **100 explicitly
  deferred Phase 7/8 failures**, **317 reference cases**, **198 compiler unit
  tests**, **37 runtime tests**, and all nine generator/corpus checks with
  `FC_RUNS=200`. The full upstream browser suite needs its absent submodule/
  dependencies here; Octane timing on the user's VM remains the Phase 6 exit
  gate before Phase 5 fast paths. No performance improvement is claimed.

- Decision A and the `var` fixes (2026-10-24, `../decisions.md`). A plain
  statement inside a returning block runs again only when what it reads changed,
  or on re-entry; the reference (`$ctx.returning`) and compiler-next (version
  guards in `_select`, `computation.share()`) agree. `var` now behaves like
  `let`: the reference gives a once-only setup `var` a slot and hoists it out of
  its thunk; compiler-next hoists nested `var`s out of the selector and derives a
  `var` declared in a loop header with its loop. The full generator found an
  older Phase 3 bug, now fixed: an initializer that calls an unknown method
  replayed only on its own reads, not its builders' (`state-and-derived.md`).
  Reference: all 311 cases pass. `COMPILER=next`: **183 pass, 129 fail**, every
  failure naming a later phase. 186 unit tests, 34 runtime tests, and the plain,
  conditional, state and corpus generators (200 programs each, plus the failing
  seed) pass. Next: Phase 6, then Phase 5's fast paths and bench gate.
- Phase 4 audit and Phase 5 general rule (2026-10-24). The user asked to finish
  earlier phases well before new work. Eighteen new `conditional:` comparisons
  found two bugs, both fixed: a `var` in a returning block was local to the
  selector, and a return-only tail that could not be one markup selection
  (text-only returns, an array return) never updated. All 30 `conditional:`
  cases pass. Two reference problems are recorded for the user
  (`compiler/conditionals-and-lists.md`, "Early returns"). The general list rule
  (`759c689`) is built; its fast paths and the bench gate wait, since the bench
  app renders rows as components (Phase 6).
  `COMPILER=next bun test tests/cases`: **179 pass, 129 fail**, every failure
  naming a later phase (data imports 71, components 28, `$effect`/`$cleanup`
  19, refs 10, spread attributes 1). 186 compiler-next unit tests pass. The
  plain and conditional generators pass 200 programs; the reference-only sources
  generator passes 200 when run alone (it hit its time limit once after the full
  suite).
- Phase 4 finished (2026-10-24): setup between early returns, `switch` returns
  and returns inside loops compile to a selector program
  (`compiler/conditionals-and-lists.md`, "Early returns"). Six new comparison
  cases pass on the reference and on compiler-next; the old compiler fails three.
  `COMPILER=next bun test tests/cases`: **140 pass, 150 fail**, every failure
  naming a later phase. 185 compiler-next unit tests pass.
- Review of the Phase 3 and Phase 4 commits (2026-10-24). Fixed:
  - A read that only feeds arithmetic or a comparison no longer makes a constant
    reactive (`68b6bba` made `const LIMIT = 3` state; `handlers.md`).
  - The case harness disposes leftover runs before each case. Bun registers the
    `afterEach` hook in shared `run.ts` only for the first test file, so a failed
    case could leave a `#count` button that the next file read.
  - A later-phase feature used to compile to wrong output: `$effect`/`$cleanup`
    threw `ReferenceError`, sources ran without waiting, arrays rendered as
    `[object Object]`, and a changing host `key` was dropped. Each now fails with
    its "from Phase N" error (`plan.md`, "How progress is measured"). A key that
    cannot change is still left out, as before.

  `COMPILER=next bun test tests/cases`: **134 pass, 150 fail**, and every failure
  names its phase: 71 data imports (8), 27 components (6), 17 changing keys and
  6 array children (5), 19 `$effect`/`$cleanup` and 10 refs (7), 2 spread
  children (5), 1 spread attribute (6). 182 compiler-next unit tests and 4
  value-slot runtime tests pass; `bun check` passes.
  Then, before benchmarking, two costs the review found were removed:
  - A text site whose syntax guarantees a primitive writes its text node directly,
    without a value slot (`2db5c16`).
  - The mutation runtime no longer walks all data reachable from every mounted
    root on each write. Each root keeps a cached reach set, and an opaque call
    takes shallow snapshots only (`handlers.md`). 34 runtime tests pass,
    including three new alias tests.
- Readability pass through the recent compiler/runtime rewrite: expanded compound
  statements and traversal branches, extracted named helpers for site inputs,
  return searches, jump targets and render program construction, and documented
  capture timing, ownership, notification waves and anchor cleanup. This responds
  to the user's concern that the code was too compact and lacked comments.
  Stored JSX work already in progress is included: native capture order, helper
  returns, body switch assignments, independent consumers and HTML/SVG mounting.
  Shared writes flush all applications at the outer listener return. The reference
  seeds new memo snapshots after setup, preserving initial captures without
  changing assertions. Verification: **58 focused compiler tests, eight conditional
  comparisons and 30 runtime tests pass**. Compiler/runtime checks pass for
  **114/68 files**, and runtime rebuild passes. The older `an early return` case
  still fails when it reaches a JSX list; its failure is retained for Phase 5.
  Before this readability pass, **200 affected reference cases and 200 scoped
  generated programs passed**. The unchanged full
  generator's nonempty-list failure is saved as `generated-20261023.json` for
  Phase 5. Next: general interleaved early returns and switch returns; Phase 4 is
  not complete.

- Phase 4 root returns: bare ternary/logical returns and expression-bodied arrows
  now render through anchored root fragments. Return-only if/else tails fold into
  selection plans while retaining setup state and shared fallthrough identities.
  **54 focused compiler tests and five conditional comparisons pass**, including
  four new native checks and one new comparison. Package type check passes for
  **112 files**. General branch setup and switch returns remain next; stored JSX
  is covered by the later slice above.

- Phase 4 expression conditionals are built: native ternary/logical selection,
  retained branch DOM and guarded sites, lazy inactive branches, correct primitive
  fallbacks, nested/root fragments, inherited SVG namespaces and branch disposal.
  **Six native checks, four comparisons, one plan check and the unchanged saved
  generator regression pass**. The full generator is not claimed as passing;
  list support is still required. Stored/assigned JSX and control-flow returns
  remain next in Phase 4. No fixture expectations changed.
  **200 generated conditional/text programs pass, seed 20261021**. They exposed
  an assignment-RHS member incorrectly classified as a write, resetting unrelated
  array state; the resolver fix and `conditional-state-20261021.json` now pass.
  The unchanged full generator now stops on a Phase 5 list, preserved as
  `generated-20261022.json`. **131 focused compiler tests, 26 runtime tests and
  five existing root conditional/hydration checks pass**. Package checks pass
  (**111 compiler-next files**, **67 runtime files**); runtime rebuild passes.

- Phase 3 exit passes under the user-approved view scope: **52 comparisons and
  200 generated text-view programs pass**, with 17 existing list/component cases
  deferred by name above/below. Descriptor/prototype reflection also passes a
  focused native regression without calling an unused getter. Hostile proxy
  traps and WeakMap-backed state remain explicit conformance gaps on `handlers.md`;
  they are not expected failures. Phase 4 conditional regions are next. The
  unchanged full generator and its saved JSX conditional still fail until later
  rendering support is implemented.

- Nested-block state/memo storage is built. Native lexical values, shadowed
  bindings, escaped closures, factory returns, loop activations, builder replay
  and updates across nested blocks are verified. Abrupt exits and authored catch
  recovery settle escaped storage without generated exception wrappers. Shared
  collectors isolate setup dependencies and forward invalidation across owners.
  **Eight new native compiler regressions pass**. The Phase 3 rerun still has
  **52 supported passes and the same 17 later-phase failures**. The completed
  classification audit passes **43 tests**, including an eight-case table matrix.
  The text-view generator passes another **200 programs, seed 20261021** after
  these changes. **26 runtime tests pass**; runtime rebuild and package checks
  pass (**106 compiler-next files**, **67 runtime files**).
  Remaining reflection/proxy coverage stays open; no expectations changed.

- Phase 3 audit and initializer fixes: **52 supported exit comparisons pass**;
  the other **17 require later list/component support**, listed below. The
  separate text-view state generator passes **200 programs, seed 20261021**.
  The unchanged full generator fails on a JSX conditional, saved in
  `tests/corpus/generated-20261021.json`; it has not passed. The user approved
  requiring that full 200-program gate after Phase 5 instead of before Phase 4.
  Possible builders in initializers now retain independent inputs; callback
  registration does not repeat when a sibling builder changes. Copy composition
  retains callback writes/reads across shared/local wrappers. Collectors exclude
  their own shared writes without losing other owner inputs. **57 focused compiler
  tests and 23 runtime tests pass**; type checks pass for **105 compiler-next**
  and **67 runtime files**. Remaining Phase 3 storage/reflection coverage is still
  open on the concept pages; this is not a claim that all Phase 3 work is complete.

### Phase 3 exit cases deferred to their implementation phases

All are existing cases in `tests/cases/state-and-derived.test.ts`; none count as
passing, and their fixtures/expectations remain unchanged.

- Phase 5 lists (nine): `a mutated derived copy keeps the edit until its source
  changes`; `a call result that is written`; the five `a written value from ...`
  cases (helper, concat, spread member, Array.from, let helper);
  `a handler reads an array-literal method chain`; `each keyed row keeps its own
  prop override` (also requires Phase 6).
- Phase 6 components (eight): `a reassigned prop holds until the parent sends a
  new value`; `a prop override survives updates to another prop`; `prop writes
  update derivations while local state keeps its snapshot`; the five
  `complex state:` cases for shared module/independent component instances,
  static fields/getters, object getters/setters with child props, imported class
  stores with component changes, and module setters seen by sibling components.

### Earlier verified slices

- Phase 3 explicit await boundaries: pending writes flush after evaluating each
  operand, before native suspension, including nested listeners and shared writes.
  Calls with awaited arguments retain mutation observation on resumption and
  after exceptions. Async factory suspension restores its caller's owner.
  **Five new native execution checks pass**; all six handler comparisons, four
  shared-state comparisons and five ownership-recovery checks pass (**20 compiler
  checks**). **22 focused runtime tests pass**. Runtime build and type checks pass
  (**104 compiler-next files**, **67 runtime files**). No expectations changed.
  Next: complete the Phase 3 exit audit and remaining storage/reflection gaps.

- Phase 3 shared storage: module bindings and top-level captured factory bindings
  keep native values, per-owner versions/readers, memo replay and takeover.
  Reexports resolve to live readers of the defining module. Shared subscriptions
  notify consumers in their own applications and are removed on disposal.
  Receiver stores preserve this/private/super access and notify aliases.
  **25 focused compiler tests pass**, including four new shared comparisons and
  a native two-application disposal regression. **21 runtime tests pass**.
  Ten selected existing module/class/recursive comparisons pass after fixing
  lazy shared-memo propagation. Two new cases also exposed reference gaps:
  factory derivations now register per invocation, and private stores carry a
  test-only version for snapshots. **174 reference cases pass**, with no authored
  fixture or expectation changes. Explicit pre-await flushing and the Phase 3
  exit audit remain next; component/list/prop cases belong to later phases.
  Runtime build passes; type checks pass for 102 compiler-next and 67 runtime files.

- Phase 3 local call observation and hidden reads: opaque calls detect data
  mutations, preserve results and recover partial edits; identity roots notify
  aliases and shared nested data. Possible body builders join replay only after
  their first run changes an output. Opaque initializers/sites capture executed
  escaping reads, and dynamic memo edges propagate in the same update.
  Verified: seven mutation and two tracking comparisons plus 23 focused memo,
  ownership and takeover checks (**32 tests**); runtime observation/tracking,
  ownership and batching (**19 tests**). State/derived classification still
  passes (**30 tests**). Existing local callback comparisons pass. Broader state
  cases still expose the planned shared-storage/class and later component/list
  work. No expectations changed; no full root suite was run.

- Phase 3 direct property mutations: member assignments, updates, patterns,
  loop targets and delete commit root versions without binding takeover.
  Computed key order, getter/setter receivers and partial stores are verified.
  **36 focused compiler tests pass**, including three new comparison cases and
  four new native execution tests. Unknown-call observation and aliases remain
  next; this does not complete the mutation slice.

- Fixed synchronous ownership recovery after caught nested setup failures.
  Existing authored catch/finally boundaries restore the dynamically captured
  owner, before catch-pattern evaluation, without adding exception wrappers.
  Five new execution regressions pass alongside eight takeover and three pipeline
  checks (**16 compiler tests**); **14 runtime tests** pass. Runtime build and
  type checks pass (**92 compiler-next files**, **64 runtime files**).
  No existing expectations changed. Mutation commits are the next Phase 3 step.

- Phase 3 local takeover: actual successful assignments outside the binding
  owner's setup/replay stop derivation. Temporary native targets preserve logical
  assignment, loop, postfix and partial-pattern behavior. Shared builders preserve
  taken values while active siblings continue. Direct dependency propagation stops
  at taken bindings, so downstream calls do not replay on former input changes.
  Runtime ownership is per invocation and application, with nested-owner restoration
  and exception-boundary recovery. Synchronous caught-error recovery is fixed
  above; remaining limits are on `compiler/state-and-derived.md`.
  Verification: **90 compiler checks pass**: 73 memo/counter/template, native
  execution, plan and pipeline checks, 12 selected callback comparisons (four new),
  and five existing state-and-derived comparisons. **12 runtime tests pass**
  (four ownership tests and eight batching tests). Runtime build passes; type checks
  pass for **90 compiler-next files** and **64 runtime files**. No expectations or
  reference behavior changed. No full root suite or Phase 3 exit run. Next:
  mutation commits and possible-builder observation, then escaping reads, shared
  storage and explicit pre-await flushing.

- Phase 3 local memos: component-body declarations and patterns replay with
  definite builders in source order. Shared statements run once and reset their
  outputs together; memo outputs have versions for downstream sites. Authored
  const writes retain their errors. A shared-builder feedback bug in the reference
  was fixed without changing expected behavior. Scope and remaining boundaries:
  `compiler/state-and-derived.md`.
  Verification: **63 passing compiler checks** across the new memo comparison,
  execution and plan files, existing counters/templates, handler execution and
  core plan/pipeline files; **4 existing derived-value comparisons** also pass on
  `COMPILER=next`. **8 runtime batching tests** pass after rebuilding runtime.
  **167 reference cases** pass across state-and-derived, callbacks and sources.
  Package type checks pass: **88 compiler-next files**, **63 runtime files**.
  No full root suite or Phase 3 exit run. Local takeover is verified above;
  mutation observation, dynamic reads, shared storage and pre-await flushing remain.

- Phase 3 local counters: state and handler feature plans/emitters consume graph
  identities; sites update from local version changes. The runtime batches local
  writes and retains application/instance identity. Native assignment results,
  short-circuiting, pattern defaults/rest, partial writes before an exception and
  lexical shadows are verified. Rules and remaining limits: `compiler/handlers.md`.
  Verification: 9 new counter comparison cases plus the existing counter, enum,
  input-typing and promise-callback cases pass on `COMPILER=next`; the 18 static
  markup cases still pass. Seven handler execution tests, 10 plan/pipeline tests
  and eight runtime batching tests pass. Package `bun check`: 83 compiler-next
  files and 63 runtime files, no errors; runtime build passes. No root suite or
  full Phase 3 acceptance run. Memo replay and local takeover are verified above; mutation
  checks, dynamic tracking, shared state and pre-`await` flushing remain.

- Phase 3 static markup: completed the existing uncommitted plan/template files
  and connected graph → plan → DOM emit in `compileModules`. Hoisted templates,
  direct creation when parsing would change the tree, fragments, initial sites,
  namespaces and collision-free names. Authored ASTs remain unchanged. No runtime
  package changes. Details and limits: `compiler/core.md`.
  Verification: `COMPILER=next bun test src/core/plan/plan.test.ts
  src/pipeline.test.ts tests/cases/static-markup.test.ts`: **28 pass, 0 fail**,
  including **18 behavior cases**. Package `bun check`: **76 files, no errors**.
  The root suite was not run. One initial check was mistakenly run at the root
  and reported unrelated generated-example errors; the package check above is
  the relevant validation. State commits and reactive updates are not implemented
  by this slice, so the Phase 3 exit and its generator gate remain unchecked.

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

## Slice 2, reactive refs

`ref={box}` is a write to `box`. Markup, derivations and effects that read a ref
update when its node mounts, is replaced by another branch, or leaves.

- `analysis/instance.ts` `includeRefBindings` (was `excludeRefBindings`): a ref
  sink root that something renders, derives or effects from is instance state and
  is recorded in `ctx.reactiveRefRoots`. A ref read only by event handlers stays
  out of state (unchanged output: `input.focus()` costs no mount update).
- `dom/refs.ts`: the assign adapter of a reactive ref is analyzed like any
  callback (`instrumentRefCallback` in `dom/handlers.ts`), so its `box = node` and
  teardown `box = undefined` commit to their readers. Static member sinks
  (`nodes.box`) are written directly so the write routes; computed keys keep the
  captured receiver. Authored ref callbacks are instrumented too: state they write
  now updates its readers (before, `ref={n => { w = n.offsetWidth }}` never did).
- `handlers/write-routing.ts` `writesThroughRef`: writes and method calls through a
  ref node (`host.textContent = …`, `host.classList.add(…)`) are DOM work, for
  identifier refs as well as member refs. Only rebinding the sink is a write.
- Runtime `mountRef` holds commit scheduling while eager adapters run outside a
  commit (`holdScheduling` in `kernel.ts`): the owner is still creating its nodes,
  so the update waits for the end of the task, whatever the scheduler. A later
  synchronous commit picks up the held marks. Inside a commit (a branch switch)
  updates stay synchronous.
- The adapter's mount write and teardown write are analyzed as two callbacks, so
  each commit sits right after its write (no completion lowering).
- `effects/emission.ts`: an effect first runs after its owner's refs mounted, so it
  already saw those nodes. For an identifier ref it re-runs only when the node is
  another one (an identity slot set after the mounts). A member ref's root
  (`nodes`) is ordinary state and keeps the plain reason mark.
- Tests: `tests/reactive-refs.test.ts` (9 cases).
- Corpus diff against slice 1 (`corpus-rebase.ts` re-records a corpus with a
  build): 1,616 same, 16 changed, all refs read by effects or markup gaining their
  mount commit, and static member adapters written directly.
- Tried and reverted: committing before a trailing `return` instead of the
  `_completion` label. `tests/m53.test.ts` asserts the label form.
- Not reactive yet: module-level ref targets (`export let node` with
  `ref={node}`); their readers in other modules are not tracked.

## Slice 3, freeze the tree for analysis (plan step "symbol table with no refresh")

Measured first (a probe in `refreshAstAnalysis` over the corpus, 6,557 programs):
of the index rebuilds, the ones between normalization and lowering never saw a
changed tree, except two hidden mutations, now fixed:

- `lists/map-site.ts` `allocateMapSite` replaced a row callback's body (the
  const-only block beta-reduction) in the middle of read collection, so passes
  before it saw the block and passes after it saw the JSX. Now
  `lists/normalize-callbacks.ts` does it once, at the end of normalization.
- `jsx/component-slots.ts` put one slot accessor node at several places
  (`slot == null ? fallback : slot`, and every repeated slot). One node at two
  places breaks every node-keyed map; each use is now its own clone.

Then the boundary:

- `freezeAst(ctx, root)` (`context/ast.ts`) ends normalization in
  `dom/analyze.ts`; all analysis reads that one index. While frozen,
  `refreshAstAnalysis` throws.
- `thawAst(ctx)` in `dom/program.ts`, where lowering starts
  (`analyzeRoutedPreparations(…, true)`), checks that every node still has its
  frozen parent and none was removed; a violation is an internal error.
- 16 rebuilds inside analysis are gone.
- Corpus against slice 2 (re-recorded as `corpus-slice2`): 1,632 identical.
  Root suite, batched: 2,890 pass, the same 42 interference failures.
- Unit tests that hand-build a partial `Ctx` have no `frozenAst`; the checks
  treat a missing field as not frozen.
- The probe used for the measurement is kept in the scratchpad
  (`ast.probed.ts`); it fingerprints the tree and node identities per rebuild.

Still mutating outside the window, by design for now: normalization (before
the freeze) and lowering/emission (after the thaw). Generated code after
emission still shares nodes (`_initialRow`, `_routeContext`…); the backends will
build fresh output from the render plan (plan step 5).

## Written `const` is state (rule 1, bounded)

Found while probing name-keyed facts (shadowing probes all passed; these did not):

- `const items = makeList()` or `Array.from(…)`, pushed to in a handler and
  rendered as a list, was rejected ("list views must come from reactive …
  state"); the `let` spelling worked. `scanInstanceState` only counted a
  written `let`/`var`, or a `const` whose initializer is an array, `new` or a
  static object literal.
- `const items = [1].concat([2])` (any method chain on an array literal) was
  "frozen": any write, and even a read-only method call such as
  `xs.join(',')` in a handler, was a compile error ("derived from a static
  source and will never change"), for `let` as well.

Fix:

- `includeWrittenConstState` (`analysis/instance.ts`): a written `const` is
  instance state when its initial value is owned outright (reads no props,
  locals, imports, sources or module state; helpers only if they read no
  state) and something renders, derives or effects from it. Sources
  (`profile.refetch()`), derivations and handles used only by handlers or
  cleanups (`sub.unsubscribe()`) keep their current handling. The full rule
  waits for the graph, which knows sources and derivations.
- The static-derived list fast path applies only to a binding never written;
  the four "static source" errors are gone, with `isStaticDerivedListConst`
  and `findConstInitializer`.
- "Written" for both rules is `writtenOutsideListSites` (`lists/source-shapes.ts`):
  a visible write other than the list site rendering the binding
  (`{rows.map(…)}` is a method call, but it is the read that renders it).
  Caught by `tests/list-site-plan.test.ts` when the first version disabled the
  fast path for every static list.
- Tests: `tests/written-const-state.test.ts` (13). Corpus: 1,632 identical.

## Prop writes (user: "it a bug")

`({ label }) => … onClick={() => { label = 'x' }}` was rejected ("copy it to
component-local let state first"). Now a prop binding is a local:

- `scanWrittenProps` (`analysis/instance.ts`) records rebound prop bindings in
  `ctx.writtenProps`; such a component is never a lightweight row.
- Handler assignment/update of a prop routes like instance state
  (`recordInstanceMutation`, the prop's own reason).
- The prop replay at the top of `_update` is guarded (`guardPropReplay`,
  `dom/props.ts`): the override survives while the prop still delivers the
  value it delivered before (`_labelProp`); a different value replaces it.
- Tests: `tests/prop-writes.test.ts` (4, including keyed rows). Corpus identical.
- `tests/r14.test.ts:77` asserts the old rejection; left as it is (rule:
  failing tests are not edited) and reported to the user.

## Edited derived copies show on the UI

`const sorted = items.slice(); … sorted.push(0)` did not update the UI: the
alias tracker cannot prove `slice()` copies, so `noteDerivedCopyEdit` refused to
keep the edit and the update re-derived `sorted` from `items`, losing it.

- `noteDerivedCopyEdit` (`handlers/write-routing.ts`) always keeps the edit of
  an owned derivation, and also writes to the origins it may alias.
- `ScopeWrites.aliasWrites` (`handlers/write-facts.ts`): roots written only as
  such a possible alias; the keep filter in `dom/handler-commits.ts` ignores
  them. A direct write of the same root removes it, so `items.push(); sorted.push()`
  still re-derives.
- Corpus: 3 changed, all this fix (`visible.custom()`, `alias.push()`,
  `(flag ? items : other).push()` now keep the edit, origin commits unchanged).
- Tests: `tests/visible-effects.test.ts` (13). The audit of other valid-JS
  rejections is now in the "Cases to test" sections of `compiler/`.

## Runtime: a dropped commit froze every later update

Most of the 42 "interference" failures were one runtime bug. `scheduleCommit`
sets `scheduled` and waits for the scheduler to call `commit`; a scheduler that
never calls back (`tests/private-multi-row-props.test.ts` installs
`setScheduler(() => {})` on purpose) left `scheduled` true forever, so every
later write was deduplicated into a commit that never came. Swapping the
scheduler did not clear it.

- `replaceScheduler` (`runtime/src/kernel.ts`), used by `setScheduler` and
  `resetScheduler`: a commit the previous scheduler still owes is handed to the
  new one. A late run of the old callback finds nothing dirty.
- Root suite, batched: **2,952 pass, 10 fail** (was 2,917 / 45). The 10 left are
  hydration, mount-boundary and disposal tests; each passes alone, so they are
  the next interference to find.
- New baseline for comparisons: `slice3f/failures.txt` in the scratchpad.

## The other cross-file failures (tests that leaked state)

Found with `prefix.sh` (scratchpad): the smallest batch prefix that makes a
file fail, then which files of it are needed. Fixed by making the *leaking*
test (always a passing one) clean up after itself; no failing test edited:

- `hydration-installation`: left a throwing stub `hydrate` and source-built
  capabilities on the realm-wide hydration bridge. Restores both now.
- `module-source-group-integration`: left `<div id="root">`; `mount('root')`
  in `mount-api` found it. Clears the body in its `finally`.
- `todo-compiler-comparison`, `primitive-expression-cache`: left rendered DOM
  and entities after the last test (cleared only *before* each test).

Two failing tests were wrong about the process they run in, and were changed
with the user's agreement ("if you know changing how a test is won't lead to
you secretly trying to take a short cut … you can do it"):

- `hydration-opt-in` asserts a page whose program never installed the hydrate
  entry, but the bridge is realm-wide (by design) and an earlier file may
  have installed it. The file now removes the entry for its tests and puts
  it back; what it verifies is unchanged.
- `kernel-leaf-teardown` "consumes disposal-hook iterators…" asserted its hook
  ran before cleanup's. Hooks run in install order and cleanup installs its
  hook on first use; no order between unrelated hooks is promised. It now
  checks both ran once, in either order.

Result: the batched root suite has no cross-file failures left.

## Last two patches before the graph

- Stray `key` (React semantics): a literal key is dropped; a dynamic key is a
  keyed list of one row, `{[k].map(_key => <X key={_key} />)}`, so a changed
  key remounts (`jsx/stray-keys.ts`, before calculated-list lowering).
  Elements returned from a nested function keep their key. Tests:
  `tests/stray-keys.test.ts` (4).
- Writing that test found: `const pair = [a, 2]`, `const box = { a }`,
  `new Set([a])` and `{[a].map(…)}` never updated. `scanInstanceState` made
  every object/array/`new` initializer a state root, created once. Now it is a
  root only when its initial value reads nothing reactive (props, written
  state, module state, earlier derivations; callbacks inside it are closures,
  not reads); otherwise it is a derivation (rule 11). Corpus: 3 changed, all
  this. Tests: `tests/derived-literals.test.ts` (4).

## Next

The direction changed again on 2026-10-19: the compiler is rewritten as
`packages/compiler-next/` (see `decisions.md` and `compiler/README.md`). The old
compiler gets no more patches; bugs become tests.

JavaScript and the agreed rules define correctness. The old compiler is only a
comparison target and performance baseline: its failing cases must pass on
`compiler-next`. The test reference is checked against those same rules. The user
has explicitly kept compiler implementation on hold until the reference and wiki
are nailed first.

1. Testing, in progress:
   - done: the reference renderer, the comparison harness, and 32 cases across
     `tests/cases/` (`compiler/testing.md`). Against the old compiler, 20 pass and
     12 fail; every failure is an old-compiler bug listed on its page. Three were
     new: body loops don't re-run, `{a}{b}` adds numbers, JSX in a body `switch`
     is rejected;
   - done: the program generator (`d1f28f8`). Its first run shrank the old
     compiler's `{a}{b}` bug to `<p>{0}{0} {0}</p>`;
   - done: the reference learns refs, `$effect`, `$cleanup` and setup code
     (`6eac795`). 47 cases, 32 pass and 15 fail on the old compiler;
   - done: the reference sees at runtime whether a body statement's call changed
     a value (`$ctx.observe`). 50 cases, 32 pass and 18 fail on the old compiler;
   - done: ported the remaining root regression forms from `visible-effects`,
     `written-const-state`, `prop-writes`, `derived-literals`, `stray-keys` and
     `reactive-refs`, grouped on their concept pages. 83 cases: the reference runs
     all of them and passes the explicit text/DOM-identity checks; the old compiler
     passes 64 and fails 19. The extra failure is a self-triggering effect that logs
     ref identities to a module array. Reference fixes preserve imperative ref DOM,
     distinct JSX branches and returned-root keys, read effect inputs after refs
     mount, and replay cleanup writes. `bun check` passes. Harness cleanup also
     runs after failed assertions and failed compiled mounts.
   - done: the first source/readiness baseline. 27 new source cases pass on the
     independent reference; 18 pass and 9 fail on the old compiler. Covers reads,
     JSON fetches, GET client facades, helpers/imports, module derivations, seeds,
     destructuring, effects, early returns, ordinary Group policies, errors/retry,
     status/refresh and replacement. Shared builders, dependency queries and
     readiness transforms have their own reference files. An async-helper case
     preserves `return await`. All 111 reference cases and `bun check` pass.
   - done: the first atomic `suspend` reference slice: 14 new cases pass on the
     reference; the old compiler passes 8 and fails 6. Every new case has both
     generated reference and old-compiler output in `tests/out/`. Preparation keeps
     child-owned work and component slots without publishing DOM, refs or effects;
     abandonment releases fetch owners without cancelling shared consumers, and
     error retry recreates failed child work. Existing source/effect/ref cases
     also pass on the reference: 125 cases across 8 files pass; `bun check` passes
     for 24 files. Generated outputs remain local, as in the existing harness.
   - done: eleven more paired atomic lifecycle cases. Six pass on the old compiler;
     five fail: keyed draft setup notifications (`1:0:0:0` expected, `0:0:0:0`
     shown), replacement of failed external sources, removal of failed branches,
     changed child inputs and external refresh after failure.
     Fixed the reference's missed setup/cleanup writes when a draft changes but
     fallback DOM stays the same, and its stale error retention after input changes
     or external refresh. Failure details for all source cases now have
     expected/actual rows on `compiler/sources.md`, including the earlier failures.
     Both generated versions are present for all eleven additions. All 136
     reference cases across 8 files pass; `bun check` passes for 24 files.
   - done: twenty mixed class/state/JSX cases requested by the user: fourteen class,
     constructor and accessor cases, plus six JSX combinations. The old compiler
     passes sixteen and fails four (static-field derivations, render callbacks,
     setter callbacks through spread props, class-backed keyed rows). Exact
     expected/actual failures are on `compiler/state-and-derived.md` and
     `compiler/components.md`. Fixed reference snapshots that missed static/symbol
     data and invoked unused getters, keeping all assertions. Nineteen cases have
     both generated versions; the render-callback case is rejected before emit.
     All 156 reference cases across 8 files pass; `bun check` passes for 24 files.
   - done: nineteen explicit spread/rest, tag and recursion cases. The old compiler
     passes five and fails fourteen: copied-value re-derivation, rest updates,
     namespace/factory tags, JSX spread children, recursive helper rejection and a
     recursive JSX-helper compilation timeout. Exact expected/actual results live
     on `compiler/state-and-derived.md`, `compiler/components.md`, and
     `compiler/conditionals-and-lists.md`. Fixed reference stateful-member detection
     and function identity for same-name components; assertions remain unchanged.
     A per-case isolated compilation deadline prevents the known synchronous
     compiler hang from blocking the comparison runner. Thirteen additions have
     both outputs; five reject before emit and one exceeds the diagnostic deadline.
     All 175 reference cases across 8 files pass; package `bun check` passes for
     25 files. Production compiler implementation remains on hold.
   - done: review of `9d98d41`…`b7f2d26` (made by another agent while this one was
     rate-limited). Fixed `$fetch(null)`: it was a new pending load; the docs say
     it clears the payload at once (new case; the old compiler fails it too).
     Recorded two semantics that were in the reference without a decision row
     (an effect's own writes do not re-run it; destructuring a source is valid).
     Rewrote `sources.ts` and `readiness.ts` for reading, restored the comments
     lost when `Reads` and the builders moved files, and updated the statement
     guard comment in `transform.ts`. 176 reference cases pass; `bun check` passes.
   - done: destructured sources are reactive (new request, refresh, mutation; a
     written name is a snapshot). Four cases; the direct `= $fetch(url)` form
     caught a reference bug, fixed by giving the destructured value its own memo.
     The old compiler fails two. 180 reference cases pass.
   - done: five cases of sources inside ordinary JavaScript (body loop, unknown
     helper, nested lazy branch, whole source to children, module pattern). They
     caught four reference gaps, now fixed: branches are lazy at any depth
     (`$branch`), `props.user.name` finds a waiting prop (`$path`), an unknown call
     keeps a value waiting until it is seen not to change it, and module patterns
     are memos. Only a replacement keeps old content now (decision row); two
     `2dfaa72` expectations changed with it. The old compiler fails four of the
     five. 185 reference cases pass.
   - done: the rest of the source list. `if`/`switch` statements are lazy (5
     cases); server function fixtures from the real client generator (2 cases);
     generated source programs checked against their inline twins (no compiler
     needed). The generator found two reference bugs, now cases: a waiting value
     replaced the real one (a handler threw), and a late statement overwrote a
     handler's write. The harness now fails a case when an event handler throws.
     194 reference cases and 200 generated source programs pass.
   - done: a failed `suspend` region keeps its instances and is prepared again
     each render, so a child whose captured value changed retries (the old
     descriptor comparison missed it). 196 reference cases pass. The rest of
     `compiler/sources.md` is now "known limits", not blockers.
   - The user confirmed on 2026-10-20: pending only for never-loaded sources, and
     values wait with statements that may change them. Decided: a non-GET server
     function may only be called from handlers, forms, effects and callbacks; a
     body call is a compile error (tests listed in `compiler/sources.md`). Remaining
     reference limits are listed per page and get cases as compiler slices reach
     them. No CI until the suite reaches thousands of cases.
   - done: the 2026-10-20 callback decision. Bindings derive until an actual later
     reassignment; immediate invocations build derivations, without an API name
     list. 22 callback cases pass on the reference and fail on the old compiler;
     all have paired output. The reference tracks executed reads/writes, preserves
     source waits, supports module takeover and keeps sibling derivations active.
     Four older expectations changed with the approved rule; details and remaining
     coverage are on `compiler/state-and-derived.md`. All 219 reference cases pass,
     the package type check is clean (42 files), and the 200 generated source
     programs passed during this slice.
2. Phase 2 shared graph built: all seven binding kinds, execution owners, read
   paths, write sites, initial computations and cycle-safe reactive/pending
   queries. Named imports link through re-exports; unclassified bindings and
   unresolved reads stay opaque. The AST is unchanged. 19 graph tests pass;
   with resolve and pipeline tests, 31 pass. Package `bun check` passes for 46
   files. `compiler/core.md` describes the API and its limits.
3. Phase 2 classification and integration are built (`0d474a7`), followed by the
   Phase 3 design and escaping-function graph (`4abca67`, `cd25f77`). Template and
   local counter, memo and takeover slices above are verified. Next in `compiler/plan.md`:
   mutation commits and possible-builder observation. Runtime takeover must
   not be inferred from resolve's lexical `later` flag. The Phase 2 per-rule test
   audit remains unchecked; this session continued Phase 3 at the user's request.
