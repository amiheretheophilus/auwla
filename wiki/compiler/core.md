# Core stages

**Folders:** `core/parse/`, `core/resolve/`, `core/graph/`, `core/plan/`,
`core/emit/` (DOM template slice built).

The core holds the stage machinery and the shared types. What a concept means
(state, a list, a ref) lives in its feature folder, not here.

## parse — `core/parse/` (built, Phase 1)

| File | What it does |
| --- | --- |
| `index.ts` | `parseModule(path, source)`: language from the path (`langFromPath`), syntax errors as `CompileError` with line and column, JSX detection |
| `lower-typescript.ts` | lowers `enum` (numbered members, reverse mapping, member names in initializers, `const enum`; `declare enum` removed) and constructor parameter properties, as `tsc` emits them, by editing the text |
| `parse.test.ts` | unit tests |

- Output: `ParsedModule` with the lowered source text. The analyzer parses that
  text again, because its model is a snapshot of the text (`toolchain.md`).
- yuku positions (`start`, `end`, diagnostics) are UTF-16 offsets, like JavaScript
  string indexes, so text edits slice by them directly. Tested with non-ASCII text.
- Not lowered yet: a runtime `namespace` and `export =`. Printing reports them as
  a `CompileError` rather than dropping them; they are valid TypeScript and must be
  lowered before acceptance (Phase 10).
- Case to test: `enum Mode { A, B }`, which the old compiler rejects
  (`packages/compiler-next/tests/cases/core.test.ts`).

## resolve — `core/resolve/` (built, Phase 1)

| File | What it does |
| --- | --- |
| `index.ts` | `resolve(parsed, options)`: one linked `yuku-analyzer` project; returns `Resolved`. Exposes binding/reference types and `isRuntimeBinding` for later stages |
| `imports.ts` | which compiled module an import names: relative paths with extension and `index` probing, `options.resolveImport` first; packages are outside |
| `writes.ts` | write sites per binding, and `runnerOf` / `declaringRunner` |
| `globals.ts` | which host globals the program writes; every other global is not an input (`state-and-derived.md`) |
| `members.ts` | whether a property read may run hidden code (a getter, a proxy): not on unwritten globals or constant plain data |
| `functions.ts` | one summary per function (captured reads, writes, calls, `this` use), built in one pass per module; `functionValue` follows immutable aliases and imports to a function |
| `escapes.ts` | escaping functions: stored, passed, returned, exported, aliased, methods and accessors; not those only ever called directly (`output.md`, "Phase 3 design", rule 5) |
| `resolve.test.ts` | unit tests |

- yuku gives bindings, references (with `isWrite`), scopes, imports, exports and
  `definition()` across files. Nothing later reads names to find bindings.
- `writes.ts` adds the fact yuku does not have: **every place a binding may
  change**, attributed to the binding at its root, at any scope (component,
  module, helper, factory closure, class):
  - `assign` (`x = 1`, `[x] = pair`, `for (x of xs)`) and `update` (`x++`);
  - `member` (`x.a.b = 1`, `x.n++`, `x[i] = 1`), `delete` (`delete x.a`);
  - `call`: a method call on the binding or a path in it (`x.list.push(1)`); every
    method call is a possible mutation;
  - `argument`: the binding or a path in it passed to a call or `new`.

  Each site has a `path` from the root (`null` for a computed key), and a
  `timing`: `body` when it runs with the code that declares the binding, `later`
  when it runs in a function inside it (handler, effect, callback, method) or an
  instance field initializer. Static fields and static blocks run with the class.
  `optimize/methods.ts` _(planned)_ is the only place that can say what a method
  does; an unknown call in a body statement is checked at runtime
  (`state-and-derived.md`).
- A callback the body runs at once (`items.forEach(x => total += x)`, an IIFE)
  is still lexically timed `later`. The graph preserves that placement as a write
  fact and does not infer a snapshot from it. Invocation context decides whether
  the write takes control (`state-and-derived.md`, "Callbacks").
- `isRuntimeBinding` excludes erased types and type-only imports. yuku's
  `visibleIn('value')` alone includes type-only import aliases.

## graph — `core/graph/` (built and wired into `compileModules`, Phase 2)

One project graph groups bindings by lexical execution owner: each module,
function, or instance field initializer. That includes components, ordinary
helpers and factory closures. An owner describes code, not a runtime instance;
separate invocations will need separate storage.

| File | What it does |
| --- | --- |
| `model.ts` | Read-only contracts for binding kinds, initial computations, body builders, read/write edges and execution owners |
| `index.ts` | `buildGraph(resolved, facts)`: allocates all runtime bindings, then connects feature-supplied reads, import aliases and resolve's write sites |
| `rules.ts` | Iterative, cycle-safe `isReactive(node)` and `pending(node, follows?)` queries |
| `classify.ts` | `classifyGraph(resolved)`: the feature order, then `buildGraph`. Returns the graph plus the dependency query cache and known component identities for planning |
| `inputs.ts` | `InputQueries`: what evaluating a node reads and writes, through visible helpers; each root, call and function is analysed once and cached |
| `classification.ts` | `BindingComputation`, the fact the derived feature hands to the state feature |
| `escaping.ts` | what each escaping function reads (its body and the helpers it calls directly, not its own parameters or locals); `buildGraph` keeps the reactive reads as `SemanticGraph.escaping`. Components are excluded |
| `test-helpers.ts` | `inspect(source)`: classify real code in feature tests |
| `graph.test.ts` | 19 shared-layer tests using real parsed bindings and references; feature classifications are supplied explicitly |
| `size.test.ts` | classification time must grow linearly with the module |

Unclassified bindings and unresolved runtime reads are `Opaque`. Binding nodes
are keyed by yuku `Binding`; unresolved nodes by `Reference`, so shadowed names
never collide. Read edges retain reference identity and property paths. Named
imports retain their local node and link to the definition, including re-exports.
Namespace/package imports remain opaque until a feature resolves their reads.

Features supply the initial kind, initializer, body builders and dependency reads.
The graph copies the fact arrays and orders builders by source position. It
preserves every write site and its runner separately from the initial computation;
no potential write changes the supplied initial kind. The authored AST and
analyzer identities remain untouched.

`pipeline.ts` runs `classifyGraph` after resolve, then `planModules` and `emitDom`.
Planning reuses classification's dependency cache and component identities.

**Speed.** A query must never scan the whole module once per binding, call or
function: before `InputQueries` and the one-pass summaries, 200 one-line
components took 23 seconds to classify; now 800 take under half a second.
`size.test.ts` guards this.

| Node | Owner | Comes from |
| --- | --- | --- |
| `Prop` | `features/props` | a component parameter or a destructured prop |
| `Constant` | `features/state` | initializer reads nothing reactive, never written |
| `State` | `features/state` | mutable value with no reactive initial computation; later takeover is recorded separately (`state-and-derived.md`) |
| `Derived` | `features/derived` | initializer reads something reactive |
| `Source` | `features/sources` | `$fetch`, `$read`, a server function call, or a helper that returns one |
| `Ref` | `features/refs` | a binding given to `ref=`, or a callback ref |
| `Effect` | `features/effects` | an `$effect` callback |
| `Handler` | `features/handlers` | an event callback, or any function that writes |
| `RenderSite` | `core/plan` | a JSX text, attribute, child, list, conditional or component-call slot |
| `Opaque` | `core/graph` | what the compiler cannot prove: unknown calls, escaping objects |

The seven binding kinds are built. `Effect`, `Handler` and `RenderSite` nodes are
planned for their feature slices. Current writes point from a runner to a binding
through the original `WriteSite`; reads point to another graph node with an
optional property path (`article.tags`).

**Classification order.** `core/graph/classify.ts` asks the features in one
fixed order, and the first that claims a binding owns it:
props → refs → sources → state/derived → opaque. The order is written only there.
Refs and sources join in their phases.

**Shared rules.** Each is written once, in `core/graph/rules.ts`:

1. **Reactive:** a node is reactive when it reads, directly or through other nodes, a
   `Prop`, `State`, `Derived`, `Source`, `Ref` or `Opaque` node. An unresolved
   global is reactive only if the program writes it (`resolve/globals.ts`).
2. **Pending:** `pending(n)` includes `n` when it is a source and every source
   reachable through its reads. It is a candidate set, not an instruction to wait
   for inactive branches. `pending(n, follows)` lets readiness planning exclude
   inactive read edges. Branch/invocation analysis and runtime guards remain
   feature work; a capture is not a read merely because a callback is created.
   An opaque read can hide further sources, so this query alone does not prove
   readiness. See `sources.md`.
3. **Opaque:** what the compiler cannot prove is never rejected. An opaque
   computation is not re-run just because its owner updated: an unknown call runs
   again only when one of its inputs changes (`const id = setInterval(…)` runs
   once). Reads hidden behind unknown callers are reported at runtime by the
   escaping functions that make them (`output.md`, "Phase 3 design", rule 5).

Verified: all seven kinds; shadowed names and separate module/function owners;
type erasure; reference/path retention; opaque globals; named imports through
re-exports; class/factory write owners; source-ordered builders; original
assignment/mutation forms; unchanged ASTs; cyclic and diamond dependencies;
reactivity propagation; branch-filtered pending sets and callback creation.

## plan — `core/plan/`

A tree of regions built from the JSX. Each site names the graph nodes it reads.

The first Phase 3 slice plans intrinsic markup returned directly by a component
(including expression-bodied arrows, fragments and markup inside expression
containers). It separates post-order DOM node indices from source-order site
evaluation: parent attributes evaluate before child expressions.

| File | What it does |
| --- | --- |
| `model.ts` | `ModulePlan`, `ComponentPlan`, `Template`, memo groups, writes and text/attribute/property/event site contracts |
| `index.ts` | Plans component setup and returned markup, retains each site's binding inputs and invokes state/write/memo feature planning; selects writable takeover candidates and distinguishes direct replay writes from nested callback writes |
| `storage.ts` | Selects the lexical activation retaining a binding: module, function or nested block; var retains its function owner |
| `template.ts` | Builds the node sequence, static markup and expression sites; keeps repeated attributes in authored order |
| `jsx.ts` | JSX whitespace, attribute aliases, namespaces and conservative template-parsing eligibility |
| `plan.test.ts` | Node addressing, expression order, graph reactivity, fallback creation and unchanged authored AST |

- `Template`: static DOM shape, hoisted.
- `TextSite`, `AttributeSite`, `PropertySite`, `EventSite`.
- `Conditional { branches: [test, Plan][] }` _(planned)_.
- `List { source, key, row: Plan }` _(planned)_.
- `ComponentCall { component, props, slots }` _(planned)_.
- `Boundary { sources, pending, error }` _(planned)_, for loading and error UI.

Features build their own pieces. Optimizations replace pieces (`optimize.md`).

## emit — `core/emit/`

- Backends: DOM template creation is built; SSR and HTML are planned.
- They read only the plan and the graph. They never look at authored syntax.
- They build new AST with `yuku-ast` builders and print with `yuku-codegen`
  (`strip: true`, source map).

| File | What it does |
| --- | --- |
| `dom.ts` | Copies module syntax, hoists markup, composes state/write feature emission, registers the component update and initializes sites |
| `shared.ts` | Composes native shared-owner versions, memo/takeover emission and cross-module readers before replacing component functions |
| `await.ts` | Adds write boundaries around native await operands and resumption, preserving suspension and rejection |
| `sites.ts` | Emits mount values and per-site version checks; skips unchanged DOM values and updates native listeners when their value changes |
| `packages/runtime/src/computation.ts` | Captures executed hidden version reads for opaque memos/sites, with stable keys and nested restoration |
| `template.ts` | Calls runtime `materializeMarkup`, or creates nodes directly when HTML parsing would alter the tree |
| `names.ts` | Allocates generated names against all authored bindings and references |
| `quote.ts` | Parses and copies generated statement snippets, filling AST holes; syntax that cannot parse at module scope uses builders directly |
| `copy.ts` | Copies authored syntax with identity-keyed replacements, without changing analyzer nodes |
| `recovery.ts` | Captures dynamic ownership around existing authored try statements and restores it before catch patterns/bodies and finally; adds no exception wrappers |
| `print.ts` | Prints JavaScript through `yuku-codegen`, erasing TypeScript |

`copy.ts` retains authored origins in external weak maps while composing feature
rewrites. Later local rewrites can reach callbacks already copied into a shared
call wrapper, without reapplying a wrapper to its own payload. Completed component
trees are sealed with `finishCopy` before the final module copy, preserving their
combined local/shared operations. Noncomputed property keys remain syntax;
rewritten shorthand values expand when needed.

Ordinary HTML uses hoisted markup and cached template cloning. Tables, raw-text
elements, parser-sensitive nesting, SVG and unproven tags use direct creation.
This fallback preserves the authored tree and SVG/foreignObject namespaces;
template eligibility is an optimization, not a restriction on accepted tags.
Text expressions replace comment placeholders so adjacent values retain separate
nodes. Empty or multi-root fragments return a `DocumentFragment`.

**Current boundary:** setup initializes native values once; planned local memos
and definite body builders replay before site updates in `_update`. State/write
and replay meaning lives in the feature plans and emitters (`state-and-derived.md`,
`handlers.md`). Every component enters/leaves runtime build ownership during setup
and replay, including static components whose body may invoke another owner's
callback. Shared module/factory storage, tracking and mutation checks are built;
explicit async boundaries are built. Nested component calls, conditional/list regions, refs and spreads
still require their planned slices. The printer currently returns code, not source
maps. The Phase 3 exit passes under the agreed view scope (`plan.md`).

**Verified:** `tests/cases/static-markup.test.ts` has 18 comparison cases with
independent DOM assertions: nesting, whitespace/entities, attributes and aliases,
fragments, adjacent primitive values, properties, tables, invalid HTML nesting,
SVG namespaces, raw text, name collisions, expression order, native event delivery,
repeated attributes and type-wrapped markup. Seven plan tests and three pipeline
tests pass with them; the pipeline also verifies separate DOM trees per invocation.

## Where to add things

- A new kind of binding: a new node kind here, owned by a new or existing feature,
  and a place in the classification order.
- A new kind of JSX site or region: a new plan type here, built by its feature.
- Never add a concept's meaning to `core/`. Add it to its feature.
