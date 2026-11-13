# Core stages

**Folders:** `core/parse/`, `core/resolve/`, `core/graph/`, `core/plan/`,
`core/emit/` (DOM template slice built).

The core holds the stage machinery and the shared types. What a concept means
(state, a list, a ref) lives in its feature folder, not here.

The [read-only analysis folder](analysis.md) exposes existing frontend facts.
Its shared frontend runs parse, resolve and graph in their existing order;
production continues in `pipeline.ts`. Serialization adds no classification rules.

Component integration adds ordered call expressions and callable references to
`core/plan/model.ts`. The template planner routes component/dynamic tags and
spread hosts through value slots. `core/emit/dom.ts` composes the component and
props feature emitters; nested component trees remain open to their enclosing
instance's lexical rewrites until that composition is complete. Static and
dynamic `ref` attributes retain their Phase 7 diagnostic.

`KeySite` records identity expressions in the source-ordered site sequence.
Stored-value plans identify their final root key by capture index, so emission
does not move it past other attributes or children. Hosts with explicit
`children` attributes use the ordered component-value path too.

Component creation registers its inactive entity before authored setup and child
mounts, preserving the kernel's existing parent-before-child ownership contract.
Failed setup uses the build scope's abandonment callback, guarded by entity
identity, so recovery cannot remove a replacement with the same id. The batch
records invalidations during initial rendering and settles them on activation.

The runtime kernel exposes `onEntityRender` immediately before scheduled and
explicit entity renders. Lifecycle features own the associated metadata and
policy; the kernel does not import those features or wrap entity callbacks.
Write-batch acknowledgement uses a weak entity index (`handlers.md`).

After general planning, `optimize/index.ts` may replace a plan; `optimize: false`
bypasses all passes. Primitive binding specialization first removes generic
slots/roots only with a complete primitive-storage proof (`optimize.md`). The
retained-index pass then annotates remaining non-primitive `TextSite`s with
`listStrategy: 'retained-index'`. Site emission selects the indexed value-slot
factory while preserving the original expression and all collectors/writes.

`core/emit/template.ts` keeps cached markup cloning for HTML and creates nodes
with the consuming namespace for inherited SVG. Namespace propagation is one
walk of the template, with HTML boundaries at `foreignObject`.
`core/emit/sites.ts` captures a conditional region's actual namespace before
removing its placeholder, so later branch mounts inherit it too.

## Dynamic attribute values

`packages/runtime/src/setters.ts` owns both cached `setAttr` and uncached
`setAttributeValue` writes. Both retain `aria-*` booleans as the strings `true`
and `false`; nullish values remove attributes. Presence-only true is reserved
for actual HTML boolean attributes, while SVG/other true values are textual.
Non-ARIA false values remain omitted. The uncached path preserves its existing
nonboolean `textValue` conversion.

An ordinary loop building JSX row values exposed an older mismatch in the
uncached setter: it omitted ARIA false and wrote true as an empty attribute.
That setter now follows the existing cached/spread rules. Focused assertions
live in `packages/runtime/tests/dom-attributes.test.ts`; the actual JSX+ loop
example exercises independent row closures and live attribute updates in both
compiler modes. This is a shared runtime correctness fix, not JSX+ syntax work
inside the compiler or a new list implementation.

## parse — `core/parse/` (built, Phase 1)

| File | What it does |
| --- | --- |
| `index.ts` | `parseModule(path, source, languages)`: language from the path (`langFromPath`), or the TSX a source language gives; syntax errors as `CompileError` with line and column in the authored text, JSX detection |
| `languages.ts` | source languages: authoring syntaxes that become TSX first (below) |
| `languages.test.ts` | a toy language through compiling, imports, errors, source maps and a project |
| `lower-typescript.ts` | lowers `enum` (numbered members, reverse mapping, member names in initializers, `const enum`; `declare enum` removed) and constructor parameter properties, as `tsc` emits them, by editing the text. A member maps back unless its value is a string, which includes `B = A`, `E.A` and `A + 'x'` over a string member. Members are kept per enum, by scope and name, so two enums `E` in different namespaces or blocks stay apart, and merged declarations of one enum share names and string members |
| `lower-namespace.ts` | lowers a runtime `namespace`, `import x = a.b`, `import x = require('m')` and `export =` as `tsc` emits them, and decides how an enum is declared when it merges or sits in a namespace |
| `text-edits.ts` | replacing spans of source text, and where an edit lands afterwards; `TracedText` and `TextOrigin`, where each part of edited text came from, for source maps (`project.md`) |
| `parse.test.ts` | unit tests |
| `text-edits.test.ts` | traced text gives `applyEdits`'s text, and maps kept, written and moved text |

- Output: `ParsedModule` with the lowered source text. The analyzer parses that
  text again, because its model is a snapshot of the text (`toolchain.md`).
- yuku positions (`start`, `end`, diagnostics) are UTF-16 offsets, like JavaScript
  string indexes, so text edits slice by them directly. Tested with non-ASCII text.
- Case to test: `enum Mode { A, B }`, which the old compiler rejects
  (`packages/compiler-next/tests/cases/core.test.ts`).

### Source languages

The `languages` option names authoring syntaxes that become TSX before the compiler reads
them. `packages/jsx-plus` gives `.auwla` this way; the compiler knows no particular language.
A `SourceLanguage` owns extensions and has `toTsx(text, path)`, which returns the TSX and a
`TextOrigin` back to the authored text, and throws a located `CompileError` for an authored
error. It reads no files and needs no particular runtime.

A language may also return optional `stylesheet` text: ordinary static CSS, not
language-specific rules. `moduleText` creates `<module-path>.css` and appends its
relative side-effect import, keeping directives and existing host offsets intact.
Parse and resolve retain that companion; `compileModulesDetailed` exposes the
`css` map separately from JavaScript `output`. Projects and the existing adapters
deliver it ([project](project.md)). `core/parse/styles.test.ts` checks this with a
toy language, not Auwla syntax. CSS source maps are not yet provided.

After that, such a module is an ordinary `.tsx` module that keeps its own path (`./App.auwla`):

- `parseModule` parses the TSX as `tsx`, keeps the authored text as `authored`, and composes the
  language's origin under the TypeScript and slot lowerings, so source maps reach the `.auwla`.
- An extensionless import also tries the language's extensions, after the JavaScript and
  TypeScript ones, as a file and as a folder's index (`importCandidates`).
- A project collects such files as source (`isSourcePath`, `collect.ts`), reading their imports
  from the TSX. A module the language rejects reports no imports; compiling it reports the error.
- The Bun plugin loads them like `.tsx` modules; the Vite plugin does the same (`packages/vite`).
- Stages after parsing locate errors in the text they read. For a language module,
  `authoredError` moves such an error back to the authored text, at the frontend and pipeline
  boundaries and around lowering. Other modules keep their errors as they were.

Not yet: `.auwla` server functions (`server/`) still recognize only JavaScript and TypeScript
files. A collected language module is translated twice, once to read its imports and once to
compile it.

### A namespace and `export =`

`lower-namespace.ts` emits what `tsc` emits, so a namespace is ordinary JavaScript by
the time anything else sees it. The old compiler rejects all of this.

```ts
namespace A {                    // var A; (function (A) {
  export let count = 1;          //   A.count = 1;
  const local = 2;               //   const local = 2;
  export function read() {       //   function read() {
    return count + local;        //     return A.count + local;
  }                              //   } A.read = read;
}                                // })(A || (A = {}));
```

- **An exported name is a property everywhere it is visible,** including later
  `namespace A { … }` blocks, which share the object but not each other's unexported
  names. Which uses change comes from the analyzer's scopes, not from names, so a
  parameter called `count` is left alone. `core/resolve/identifier-uses.ts` hands those
  answers to parse as plain records, which keeps `yuku-analyzer` in `core/resolve/`.
- **Merging.** A class, function or enum already declares the name, so the namespace adds
  no `var`. `export var` can only appear once, so merged exported enums and namespaces
  declare it once. This also fixed `export enum E {}` written twice.
- **The parameter takes the namespace's name,** unless something inside declares that name.
  Then it becomes `A_1`, as `tsc` emits, so `function f(A) { return count; }` still works.
- **An exported function or class is read by its own name in the block that declares it,**
  as `tsc` emits it; other blocks read `A.f`. A function is hoisted, so
  `export const value = read()` before `export function read()` works, where `A.read()` would
  run before `A.read = read`. A call keeps `this` undefined, and a class's body sees its inner
  name before `A.C` is assigned (`static self = C`). Until a review found it, functions were
  read as `A.f` everywhere.
- **A namespace with only types has no runtime part.** It becomes `declare`, which printing
  erases. The rule for what counts as a runtime part is `tsc`'s (`isInstantiated`).
- **`import x = a.b`** becomes `var x = a.b`. If nothing reads `x` as a value, it is dropped,
  because it may name a type.
- **`export = value`** becomes `export default value`. It leaves nothing for a name with no
  value. A name merges across declarations, so `interface Box` beside `const Box` (or
  `declare const Box`, or a namespace with values) has one.
- **`import x = require('m')`** becomes `import x from 'm'` when `m` has `export =`, and
  `import * as x from 'm'` when it does not, because that is what requiring each one gives.
  That depends on the other module, so `withRequireImports` in `core/resolve/imports.ts`
  settles it. A package stays `import x from 'm'`, where the bundler's interop gives
  `module.exports` as the default.
- **Refused, as `tsc` refuses:** `export { x }`, `export default` and `import x = require()`
  inside a namespace, each a `CompileError` with its position.
- **`import { x } from './m'` when `m` has only `export =`** is not a named export of `m`, so it
  reads as a missing export. `tsc` allows it only for a namespace under `esModuleInterop`.
  Import the default instead.

The reference reads this lowered text too (`tests/reference/transform.ts`), since these forms
have no JavaScript of their own. The lowering is checked on its own by running its output
(`parse.test.ts`), and `tests/cases/core.namespaces.test.ts` compares state and components
inside namespaces with the reference.

A statement that assigns a value and reads it, as `(function (A) { … })(A || (A = {}))` does,
must not depend on that value: an edit from a handler would run it again and reset the
namespace. A build's assignment now reports its own output (`noteOwnOutput`, used by the helper
in `core/emit/shared.ts`).

## resolve — `core/resolve/` (built, Phase 1)

| File | What it does |
| --- | --- |
| `index.ts` | `resolve(parsed, options)`: one linked `yuku-analyzer` project; returns `Resolved`. Exposes binding/reference types and `isRuntimeBinding` for later stages |
| `imports.ts` | which compiled module an import names: relative paths with extension and `index` probing, `options.resolveImport` first; packages are outside. Also settles `import x = require('m')` once the other module is known |
| `identifier-uses.ts` | scope answers for lowering a namespace, as plain records, so `core/parse/` does not import `yuku-analyzer` |
| `exports.ts` | shared value-export identities, captured defaults, namespaces, type erasure, conflicts and cycles (`linking.md`) |
| `writes.ts` | write sites per binding, and `runnerOf` / `declaringRunner` |
| `globals.ts` | which host globals the program writes; every other global is not an input (`state-and-derived.md`) |
| `ambient.ts` | appends the import of an ambient framework data call (`$fetch`, `$read`, `$track`, `$forms`) a module uses without a binding, before analysis, so later stages resolve it by binding identity (`sources.md`); `lifecycleKind` recognizes ambient `$effect`/`$cleanup` calls by binding (`effects.md`) |
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
- Assignment-target traversal follows only left/pattern target positions.
  RHS members, computed pattern keys, default RHS expressions and loop sources
  stay reads. A generated conditional program exposed a false property-write
  edge that reset an unrelated array; the saved regression and resolver unit
  check now pass.
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

The DOM plan covers intrinsic markup, expression/arrow returns and return-only
if/else tails (through `features/conditionals/returns.ts`), fragments and markup
inside expression containers. It separates post-order DOM node indices from source-order site
evaluation: parent attributes evaluate before child expressions.

| File | What it does |
| --- | --- |
| `model.ts` | `ModulePlan`, `ComponentPlan`, `Template`, memo groups, writes and text/attribute/property/event site contracts |
| `index.ts` | Plans component setup and returned markup, retains each site's binding inputs and invokes state/write/memo feature planning; selects writable takeover candidates and distinguishes direct replay writes from nested callback writes |
| `storage.ts` | Selects the lexical activation retaining a binding: module, function or nested block; var retains its function owner |
| `template.ts` | Builds the node sequence, static markup and expression sites; keeps repeated attributes in authored order; shares the primitive-result query with the optional binding proof |
| `jsx.ts` | JSX whitespace, attribute aliases, namespaces and conservative template-parsing eligibility |
| `plan.test.ts` | Node addressing, expression order, graph reactivity, fallback creation and unchanged authored AST |

- `Template`: static DOM shape, hoisted.
- `TextSite`, `AttributeSite`, `PropertySite`, `EventSite`, `RefSite`.
- `RefPlan` implicit assignments reuse ordinary write/mutation emission.
- `LifecycleCallPlan` and `EffectGroupPlan` keep registration calls and their
  activation roots. Early-return ownership is reconciled with the selector.
- `ConditionalSite`: native selection tree, selector inputs and branch templates/sites (expression form built).
- `RenderValuePlan`: stored JSX, with source-ordered captured sites and one destination-aware template in `ModulePlan.values`.
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
| `component-key.ts` | The key a module-level component is defined under, which hot replacement matches (`components.md`, "Keys") |
| `shared.ts` | Composes native shared-owner versions, memo/takeover emission and cross-module readers before replacing component functions |
| `await.ts` | Adds write boundaries around native await operands and resumption, preserving suspension and rejection |
| `sites.ts` | Emits mount values and per-site version checks; skips unchanged DOM values, retains optimized text disposal guards, and updates native listeners when their value changes |
| `locals.ts` | Removes generated locals a view's body turned out not to use, which a minifier cannot prove safe to drop |
| `render-value.ts` | Separates a stored JSX program's mount/update/disposal from the native expression that captures its inputs |
| `render-value.test.ts` | Reference comparisons for one stored template consumed in HTML and SVG, updates/remounting, fragment text roots, custom tags and foreignObject boundaries |
| `core/emit/row-list.test.ts` | Reference comparison for custom compiled rows consumed in both namespaces through edits, reordering and clearing |
| `packages/runtime/src/render-value.ts` | Keeps program metadata in a WeakMap and gives each consuming slot its own anchored DOM range |
| `packages/runtime/src/computation.ts` | Captures executed hidden version reads for opaque memos/sites, with stable keys and nested restoration |
| `template.ts` | Hoists one description per template and emits its clone and `firstChild`/`nextSibling` navigation (`packages/runtime/src/markup.ts` builds and caches it) |
| `names.ts` | Allocates generated names against authored names; `of(node, base)` shares distinct roles for one authored node |
| `quote.ts` | Parses and copies generated statement snippets, filling AST holes; syntax that cannot parse at module scope uses builders directly. A snippet's offsets are zeroed, as a built node's, so source maps leave it unmapped |
| `copy.ts` | Copies authored syntax with identity-keyed replacements, without changing analyzer nodes |
| `recovery.ts` | Captures dynamic ownership around existing authored try statements and restores it before catch patterns/bodies and finally; adds no exception wrappers |
| `patterns.ts` | Binding patterns as emitted code needs them: their bound names, and the pattern as an assignment target |
| `print.ts` | Prints JavaScript through `yuku-codegen`, erasing TypeScript; with `sourceMaps`, also its map |
| `source-map.ts` | Moves the printer's map from the analyzed text to the authored text (`project.md`, "Source maps") |
| `source-map.test.ts` | Maps read with `@jridgewell/trace-mapping` point at authored names through TypeScript, slots, routes and `require` |
| `core/diagnostics.ts` | `CompileError`: a reported error with its place in the authored module (framework API contracts only, `sources.md`; valid JavaScript is never an error) |

`copy.ts` retains authored origins in external weak maps while composing feature
rewrites. Later local rewrites can reach callbacks already copied into a shared
call wrapper, without reapplying a wrapper to its own payload. Completed component
trees are sealed with `finishCopy` before the final module copy, preserving their
combined local/shared operations. Inside a sealed tree, copying never follows a
node's authored origin back to an earlier rewrite, but a later pass may still
replace a node it found in that tree by identity: exception recovery
(`recovery.ts`) runs over the final module and must reach every authored `try`
(2026-10-27; a Phase 8 change that cloned sealed trees wholesale dropped
`captureBuildScope` and failed `features/derived/recovery.test.ts`).
Noncomputed property keys remain syntax; rewritten shorthand values expand when
needed.

Every template is one hoisted description (`emitNodes` in
`core/emit/template.ts`; format: `TemplateNode` in `runtime/src/markup.ts`):
nested `[tag, attributes, ...children]` arrays, strings for text, `''` for a
text slot and `null` for a region's comment. The runtime builds it with DOM
calls once per document and namespace, and each mount clones it
(`cloneTemplate`) and reaches every node it needs through `firstChild` and
`nextSibling`. No markup is parsed, so adjacent text slots stay separate, and
tables, raw-text elements, parser-sensitive nesting and SVG need no special
case. Several roots arrive in a `DocumentFragment`. A root that is itself a
text or region site is moved into its own fragment after navigation: its value
can expand beyond its anchor, and the caller inserts that whole range. A server
document builds and clones the same way. compiler-next emits no hydration yet
(Phase 10), so `cloneTemplate` refuses a hydrating environment instead of
creating new nodes.

Until 2026-10-28 each template was emitted three times: the builder, a
`materializeMarkup` fallback for hydration and server documents, and an SVG
copy of that fallback. Octane's compiled app fell from 41.1 KB to 19.0 KB
minified (7.2 to 4.5 KB gzip) when they became one description.

Namespaces are the planner's rule, applied again by the runtime builder
(`buildNode`): a template starts in the namespace it was planned in
(`Template.namespace`: `svg` for a branch inside `<svg>`), or in the consuming
slot's namespace when an element follows the destination (`inheritedNodes`);
an `svg` tag starts SVG and `foreignObject` restarts HTML below itself.
Stored JSX emits one mount/update/disposal program for both namespaces and
passes the consuming namespace to the same `emitNodes` used by components; the
template cache keeps independent HTML and SVG prototypes. Compiled element rows
use the same creation. `RenderValuePlan` therefore keeps one template; row keys,
captures and site order still come from the same authored syntax.
`Template.markup` is no longer emitted; it records whether the HTML parser
would keep the tree, for hydration in Phase 10.

A text site that the syntax does not prove primitive creates its value slot on
the first value that is an object (stored JSX, an array). Until then it writes
text directly, which is what a new slot writes for any other value; once
created, the slot stays, and after disposal the site holds `disposedValueSlot`,
which ignores writes as a disposed slot does. Most such sites
(`{props.item.label}`) only ever show text and never allocate a slot. Each write
is one line, `(slot = childSlot(slot, text, value, owner, indexed))?.write(value)`
(`runtime/src/render-value.ts`): the slot is stored before its first write,
which can throw, so disposal still reaches it. The slot's `RenderOwner` is
declared once: per row list for its rows (`_rowOwner`), otherwise where the sites
first need one (`_slotOwner`); a branch declares its own, since its namespace
differs. Until 2026-10-28 every write repeated the text/slot choice inline and
built the owner object literal at each slot creation; one line per write took
Octane's compiled app from 11.6 KB to 10.8 KB minified.

Unclaimed JSX becomes a captured program after component templates
are planned; the authored AST and lexical capture expressions remain unchanged.

The current emitters keep each operation on its own line and use named helpers
for site inputs, guarded statements, render entries and program declarations.
Comments describe ownership and evaluation-order constraints at their boundaries.

**Current boundary:** setup initializes native values once; planned local memos
and definite body builders replay before site updates in `_update`. State/write
and replay meaning lives in the feature plans and emitters (`state-and-derived.md`,
`handlers.md`). Every component enters/leaves runtime build ownership during setup
and replay, including static components whose body may invoke another owner's
callback. Shared module/factory storage, tracking and mutation checks are built;
explicit async boundaries, conditional regions and stored JSX are built. Nested component calls, list regions, refs and spreads
still require their planned slices. The printer currently returns code, not source
maps. The Phase 3 exit passes under the agreed view scope (`plan.md`).

**Verified:** `tests/cases/core.static-markup.test.ts` has 18 comparison cases with
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
