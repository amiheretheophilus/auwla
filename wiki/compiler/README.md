# The compiler (rewrite)

**Status: Phase 1 skeleton built; Phase 2 graph next.** The new compiler lives in
`packages/compiler-next/` on branch `compiler-rewrite`; its tests are in
`packages/compiler-next/tests/`. `packages/compiler/` stays until every suite passes
on the new one; then it is deleted.

The source, ordinary `Group`, atomic `suspend`, and callback baselines are verified.
All 219 reference cases pass. Remaining reference limits are on the concept pages;
extend their coverage as the compiler reaches those slices. Continue in `plan.md`.

> "the goal is to write normal javascript and get effecient compiled output"

Every valid JavaScript program is accepted, and every effect the console would show
shows on the UI (`../rules.md`, rule 10).

**Goal: better than the old compiler, in correctness and in speed.** The user: "we
have to be better than the old compiler both correctness and performance". On the
last benchmark (`d6e678b`, see `testing.md`) the old compiler ranked second of ten
in Octane, after ripple and ahead of Solid; those numbers are the floor to beat.
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
