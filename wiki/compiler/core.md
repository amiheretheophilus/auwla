# Core stages

**Folders:** `core/parse/`, `core/resolve/`, `core/graph/`, `core/plan/`,
`core/emit/` _(planned)_.

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

## graph — `core/graph/` (shared layer built, Phase 2)

One project graph groups bindings by lexical execution owner: each module,
function, or instance field initializer. That includes components, ordinary
helpers and factory closures. An owner describes code, not a runtime instance;
separate invocations will need separate storage.

| File | What it does |
| --- | --- |
| `model.ts` | Read-only contracts for binding kinds, initial computations, body builders, read/write edges and execution owners |
| `index.ts` | `buildGraph(resolved, facts)`: allocates all runtime bindings, then connects feature-supplied reads, import aliases and resolve's write sites |
| `rules.ts` | Iterative, cycle-safe `isReactive(node)` and `pending(node, follows?)` queries |
| `graph.test.ts` | 19 shared-layer tests using real parsed bindings and references; feature classifications are supplied explicitly |

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

**Not wired into `compileModules` yet.** The next Phase 2 step supplies feature
classification and invokes this stage from `pipeline.ts`. This shared layer does
not infer read sets, component props, callback invocation behavior or function
summaries. It does not emit code.

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

**Classification order.** `core/graph/classify.ts` _(planned)_ asks the features in one
fixed order, and the first that claims a binding owns it:
props → refs → sources → state/derived → opaque. The order is written only there.

**Shared rules.** Each is written once, in `core/graph/rules.ts`:

1. **Reactive:** a node is reactive when it reads, directly or through other nodes, a
   `Prop`, `State`, `Derived`, `Source`, `Ref` or `Opaque` node.
2. **Pending:** `pending(n)` includes `n` when it is a source and every source
   reachable through its reads. It is a candidate set, not an instruction to wait
   for inactive branches. `pending(n, follows)` lets readiness planning exclude
   inactive read edges. Branch/invocation analysis and runtime guards remain
   feature work; a capture is not a read merely because a callback is created.
   An opaque read can hide further sources, so this query alone does not prove
   readiness. See `sources.md`.
3. **Opaque:** an opaque node is re-read when its owner updates. It is never rejected.

Verified: all seven kinds; shadowed names and separate module/function owners;
type erasure; reference/path retention; opaque globals; named imports through
re-exports; class/factory write owners; source-ordered builders; original
assignment/mutation forms; unchanged ASTs; cyclic and diamond dependencies;
reactivity propagation; branch-filtered pending sets and callback creation.

## plan — `core/plan/`

A tree of regions built from the JSX. Each site names the graph nodes it reads.

- `Template`: static DOM shape, hoisted.
- `TextSite`, `AttributeSite`, `PropertySite`, `EventSite`.
- `Conditional { branches: [test, Plan][] }`.
- `List { source, key, row: Plan }`.
- `ComponentCall { component, props, slots }`.
- `Boundary { sources, pending, error }`, for loading and error UI.

Features build their own pieces. Optimizations replace pieces (`optimize.md`).

## emit — `core/emit/`

- Backends: DOM (browser), SSR (server HTML), HTML (static initial content).
- They read only the plan and the graph. They never look at authored syntax.
- They build new AST with `yuku-ast` builders and print with `yuku-codegen`
  (`strip: true`, source map).

## Where to add things

- A new kind of binding: a new node kind here, owned by a new or existing feature,
  and a place in the classification order.
- A new kind of JSX site or region: a new plan type here, built by its feature.
- Never add a concept's meaning to `core/`. Add it to its feature.
