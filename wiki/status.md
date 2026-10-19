# Status

Last updated: 2026-10-19.

## Branches

- Repository: `amiheretheophilus/auwla` (remote `origin`), from 2026-10-19. Push
  only there. The old `snrraptopack/memo-exp` is remote `memo-exp`, with its push URL
  disabled. Its account has a billing lock, so CI cannot run there. See `../AGENTS.md`.
- `compiler-rewrite` (working branch, from `compiler-refactor` at `6230c27`):
  the new compiler, designed in `compiler/`. No code yet.
- `compiler-refactor`: the old compiler's refactor, stopped on 2026-10-19. The
  sections below record that work.
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

1. Testing, in progress:
   - done: the reference renderer, the comparison harness, and 32 cases across
     `tests/cases/` (`compiler/testing.md`). Against the old compiler, 20 pass and
     12 fail; every failure is an old-compiler bug listed on its page. Three were
     new: body loops don't re-run, `{a}{b}` adds numbers, JSX in a body `switch`
     is rejected;
   - next: the program generator (`fast-check`); the reference learns refs,
     `$effect` and sources; port the root tests listed above (`visible-effects`,
     `written-const-state`, `prop-writes`, `derived-literals`, `stray-keys`,
     `reactive-refs`) as cases. No CI until the suite reaches thousands of cases.
2. Core: parse and resolve on yuku 0.19 (`compiler/toolchain.md`), then the graph.
3. Features in slices, each end to end: static markup → state and text → handlers →
   conditionals → lists → components → sources and readiness → effects and refs →
   linking.
