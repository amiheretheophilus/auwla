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
| `index.ts` | `resolve(parsed, options)`: one `yuku-analyzer` project for every module, linked; returns `Resolved` |
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
- Known limit, for Phase 2: a callback the body runs at once
  (`items.forEach(x => total += x)`, an immediately invoked function) is timed
  `later`, so `total` would be a snapshot. In JavaScript it runs with the body. The
  graph must decide this from the call, without a method list deciding semantics
  (`../rules.md`, rule 3). Ask the user before choosing.

## graph — `core/graph/`

One graph per component and one for module scope.

| Node | Owner | Comes from |
| --- | --- | --- |
| `Prop` | `features/props` | a component parameter or a destructured prop |
| `Constant` | `features/state` | initializer reads nothing reactive, never written |
| `State` | `features/state` | written after its declaration (see `state-and-derived.md`) |
| `Derived` | `features/derived` | initializer reads something reactive |
| `Source` | `features/sources` | `$fetch`, `$read`, a server function call, or a helper that returns one |
| `Ref` | `features/refs` | a binding given to `ref=`, or a callback ref |
| `Effect` | `features/effects` | an `$effect` callback |
| `Handler` | `features/handlers` | an event callback, or any function that writes |
| `RenderSite` | `core/plan` | a JSX text, attribute, child, list, conditional or component-call slot |
| `Opaque` | `core/graph` | what the compiler cannot prove: unknown calls, escaping objects |

Edges: `reads(a → b)` with an optional property path (`article.tags`), and
`writes(handler → state)`.

**Classification order.** `core/graph/classify.ts` _(planned)_ asks the features in one
fixed order, and the first that claims a binding owns it:
props → refs → sources → state/derived → opaque. The order is written only there.

**Shared rules.** Each is written once, in `core/graph/rules.ts` _(planned)_:

1. **Reactive:** a node is reactive when it reads, directly or through other nodes, a
   `Prop`, `State`, `Derived`, `Source`, `Ref` or `Opaque` node.
2. **Pending:** `pending(n)` is the set of `Source` nodes `n` reads, directly or
   through other nodes. See `sources.md`.
3. **Opaque:** an opaque node is re-read when its owner updates. It is never rejected.

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
