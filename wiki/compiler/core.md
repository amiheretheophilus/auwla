# Core stages

**Folders:** `core/parse/`, `core/resolve/`, `core/graph/`, `core/plan/`,
`core/emit/` _(planned)_.

The core holds the stage machinery and the shared types. What a concept means
(state, a list, a ref) lives in its feature folder, not here.

## parse — `core/parse/`

- Chooses the language from the path (`langFromPath`): `js`, `jsx`, `ts`, `tsx`.
  TSRX is not supported.
- Lowers `enum` and parameter properties, which `yuku-codegen` does not convert.
  Case to test: `enum Mode { A, B }`, which the old compiler rejects
  (`packages/compiler-next/tests/cases/core.test.ts`).
- Output: source text and language.

## resolve — `core/resolve/`

- Runs `yuku-analyzer` once per file and returns a `Resolved` view: module,
  bindings, references, imports, exports.
- Adds the one fact yuku does not have, **mutation sites** per binding:
  - member assignment and update (`x.a = 1`, `x.n++`, `delete x.a`);
  - a method call on the binding (`x.push(1)`) or on a path inside it
    (`x.list.push(1)`);
  - the binding passed to a function the compiler cannot see.

  Every method call is a possible mutation. `optimize/methods.ts` _(planned)_ is the
  only place that can say what a method does; an unknown call in a body statement is
  checked at runtime (`state-and-derived.md`).
- Output: `Resolved`. Nothing later reads names to find bindings; it asks this.

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
