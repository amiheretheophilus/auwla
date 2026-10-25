# The compiler (rewrite)

**Status: general state, conditionals, lists, components and props are built.** The new compiler lives in
`packages/compiler-next/` on branch `compiler-rewrite`; its tests are in
`packages/compiler-next/tests/`. `packages/compiler/` stays until every suite passes
on the new one; then it is deleted.

Phases 1–4 and the Phase 5 general list rule are implemented. Phase 6 adds ordered
component props, children, native/member/dynamic tags, factories, recursion,
prop overrides, component values and real application-root mounting. Both the
inline-row and component-row benchmark sources pass local 1,000-row correctness
checks. Case/reference and generated-program checks pass within their current
coverage. A subsequent boundary audit adds failed-mount ownership, initial-write
settling, symbol/rest props, destination namespaces and retention checks; exact
results and commits are in `../status.md`.

The remaining case failures explicitly name Phase 7 (effects, cleanup and refs)
or Phase 8 (sources/readiness). The reference already covers those semantics.
The supplied VM report at `874c826` fails the performance floor: the old compiler
is faster on all 24 Octane operations, and the DOM update-style run ends in an
OOM. Phase 5 fast paths and repeat measurements remain before the Phase 6 exit;
the correctness audit does not establish the cause or resolution of that OOM.
Remaining conformance gaps stay on their concept pages. Continue in `plan.md`.

The optimization stage and on/off comparisons are built. Passes retain private
row-matching tables, skip snapshots for proven intrinsic calls, reuse eligible
map results and target strict comparisons through keyed dependencies. Each keeps
its general fallback (`optimize.md`). Direct iteration lowering, targeted
structural updates and row creation costs remain before the Phase 5 performance
exit; current timings still trail the old compiler.

> "the goal is to write normal javascript and get effecient compiled output"

Every valid JavaScript program is accepted, and every effect the console would show
shows on the UI (`../rules.md`, rule 10).

**Goal: better than the old compiler, in correctness and in speed.** The user: "we
have to be better than the old compiler both correctness and performance". On the
earlier baseline (`d6e678b`, see `testing.md`) the old compiler ranked second of
ten in Octane. In the supplied `874c826` report it ranks third and the rewrite
tenth; the rewrite must improve on the old compiler's performance.
Emitted code is judged on speed only. Order of work: a case gets a correct general
path first, then its fast paths (`optimize.md`).

**Why a rewrite.** In the old compiler, one shared mutable `Ctx` (121 fields, used by
133 files) is read and written by passes that edit one AST in place. Each concept
is spread over several passes, and facts are keyed by AST nodes, so 31
`refreshAstAnalysis` calls rebuild them after edits. An average fix touched about
7 files. The rules below remove each of those causes.

## Pipeline

```
source text
  → parse     core/parse                       pick the language (js, jsx, ts, tsx)
  → resolve   core/resolve                     yuku-analyzer: bindings, references, writes, captures, imports
  → graph     core/graph + features/*/classify one node per binding, effect, handler and render site
  → plan      core/plan  + features/*/plan     the render plan: regions and sites
  → optimize  optimize/*                       swap a general plan for a proven faster one
  → emit      core/emit  + features/*/dom|ssr  new AST → yuku-codegen → code and source map
```

Rules for the whole pipeline:

1. **The authored AST is never edited.** yuku-analyzer's model is a snapshot of
   the source, so an edit would make every later query wrong. Later stages build
   new nodes.
2. **Each stage takes the previous stage's result and returns its own.** There is
   no shared mutable context. Options (runtime paths, delivery mode, hot reload)
   are one read-only object.
3. **`pipeline.ts` is the only file that orders stages.** Read it top to bottom to
   see the whole compiler.
4. **Facts are keyed by yuku `Binding` and `Reference` objects**, never by name and
   never by a node that might be cloned.
5. **A feature depends on `core/` only**, never on another feature's files.
6. **What the compiler cannot prove becomes `Opaque`**, never an error. Generated
   code never contains `try`/`catch`/`finally`.

## Folders

```
packages/compiler-next/src/
  index.ts          public API, the same as packages/compiler
  pipeline.ts       orders the stages
  core/
    parse/  resolve/  graph/  plan/  emit/
  features/
    props/  state/  derived/  refs/  sources/  effects/  handlers/
    conditionals/  lists/  components/
  optimize/         fast paths; each falls back to the general rule
  link/             several modules compiled together
  diagnostics/

packages/compiler-next/tests/
  reference/        the plain-JavaScript reference renderer (test-only)
  harness/          runs a case on the reference and on a compiler, and compares
  cases/            one <page>.test.ts per wiki page, with that page's cases
```

A feature folder holds only the stages it takes part in:

| File | Stage |
| --- | --- |
| `classify.ts` | graph: the nodes this feature owns |
| `plan.ts` | plan: the regions or sites it builds |
| `dom.ts`, `ssr.ts` | emit: its code for each backend |
| `<feature>.test.ts` | unit tests of its graph and plan facts. Behaviour cases live in `tests/cases/<page>.test.ts` (see `testing.md`) |

## Pages

One page per group of related files:

| Page | Covers |
| --- | --- |
| [plan.md](plan.md) | **the order of work**: phases, steps, exit checks. Start here to continue |
| [output.md](output.md) | what the compiler emits: the old output, the reference, the proposal |
| [toolchain.md](toolchain.md) | yuku packages and other libraries, and what each replaces |
| [core.md](core.md) | parse, resolve, graph, plan, emit |
| [state-and-derived.md](state-and-derived.md) | props, state, derived values: the classification rules |
| [refs.md](refs.md) | element refs and callback refs |
| [sources.md](sources.md) | `$fetch`, `$read`, server functions, readiness |
| [effects.md](effects.md) | `$effect`, `$cleanup` |
| [handlers.md](handlers.md) | event handlers, writes and mutation |
| [conditionals-and-lists.md](conditionals-and-lists.md) | conditional regions, lists, keys |
| [components.md](components.md) | components, props objects, children and slots |
| [optimize.md](optimize.md) | the fast-path contract |
| [linking.md](linking.md) | several modules, module state, routes, server functions |
| [testing.md](testing.md) | how the compiler is tested, locally and on CI |

## Keeping these pages true

- Every page uses the same sections: folders, what it does, files, rules,
  inputs and outputs, where to add things, open questions.
- A page describes the code as it is now. History goes in `../decisions.md` and git.
- A page changes in the same commit as the code it describes.
- `scripts/check-wiki.ts` _(planned)_ fails when a page names a file that does not
  exist. A file that is not written yet is marked _(planned)_ and skipped.
