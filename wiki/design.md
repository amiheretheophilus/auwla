# Design draft: semantic graph and render plan

**Status: accepted by the agent (in charge since 2026-10-18). Answers to the questions are in `decisions.md`.**
Questions for the user are marked **Q**.

## 1. Stages and what each owns

| Stage | Input | Output | May mutate the AST? |
| --- | --- | --- | --- |
| Normalize | parsed ESTree | normalized ESTree | yes, only here |
| Resolve | normalized ESTree | `SymbolTable` | no |
| Graph | AST + symbols | `ComponentGraph` per component, `ModuleGraph` | no |
| Plan | graphs | `RenderPlan` per component | no |
| Optimize | render plan | render plan (annotated) | no |
| Emit | render plan + graphs | DOM / SSR / HTML output | builds new AST only |

Each stage returns a value; there is no shared mutable `Ctx`. A stage's options
(runtime paths, delivery mode, hot reload) are a small read-only config object.

### Normalize

Everything that today rewrites syntax before analysis moves here, and only here:
component declarations, slots, conditional JSX directives, source choices,
read replays, bodyless fetch imports, transparent groups, router JSX,
and early returns turned into one conditional return. After this stage the AST
is frozen.

### Resolve

One walk builds:

- `Symbol { id, name, kind, declaration, scope }`, where `kind` is one of
  import, module binding, component, function, parameter, local binding;
- `references: Map<Identifier, SymbolId>` and `writes: Map<SymbolId, WriteSite[]>`.

Because the AST is frozen, node identity is stable, and every later fact is keyed
by `SymbolId`. This removes all `refreshAstAnalysis()` / `refresh()` calls.

## 2. The semantic graph

One graph per component, plus one for module scope. Nodes:

| Node | Comes from |
| --- | --- |
| `Prop` | a component parameter or destructured prop |
| `State` | a binding that is written after its declaration (any `let`/`const` object that is mutated; spelling does not matter) |
| `Source` | `$fetch`, `$read`, a server function call, or a call to a helper that returns one (same module or imported) |
| `Derivation` | a binding whose value is computed from other nodes and never written |
| `Seed` | a `State` whose initial value reads a node that can be loading |
| `Ref` | a DOM element binding; written by the runtime at mount |
| `Effect` | `$effect` callback, and its condition when it has one |
| `Handler` | an event callback; its writes are edges to `State` |
| `RenderSite` | a JSX text, attribute, list, conditional or component-call slot |
| `Opaque` | anything the compiler cannot prove: unknown calls, escaping objects |

Edges are `reads(a → b)`, with an optional property path (`article.tags`),
and `writes(handler → state)`.

### Rules (each written once)

1. **Reactive:** a node is reactive when it transitively reads a `Prop`, `State`,
   `Source`, `Ref` or `Opaque` node. Nothing depends on `let` vs `const`.
2. **Readiness:** `pending(n)` = the set of `Source` nodes `n` transitively reads.
   Every node with a non-empty `pending(n)` waits for those sources:
   a derivation yields "not ready", a seed applies once they commit, an effect
   first runs once they commit, a chained source does not start, a render site
   shows the boundary's pending presentation. This one rule replaces the
   separate gating code in `read-rewriting.ts`, `read-transforms.ts`,
   `module-read-lowering.ts` and `group-lowering.ts`.
3. **Seeds:** a seed takes its value when its sources commit, unless the state
   was written first. That fixes the known overwrite bug.
4. **Refs are reactive:** a `Ref` is a node like `State`, so a derivation or render
   site that reads `ref.offsetWidth` updates when the element mounts. No ref plus effect.
   **Q:** should reading a ref's layout properties also follow resizes, or only mount?
5. **Opaque:** an `Opaque` node is re-read conservatively (polled at the owner's
   update), never rejected. Method lists only upgrade an `Opaque` read to a precise one.
6. **Invalidation reasons:** each `writes` edge gets a reason id; a render site or
   effect updates only for reasons on its paths (today's instance-reason routing).

## 3. The render plan

A tree of regions built from the JSX, where each site names the graph nodes it reads:

- `Template`: the static DOM shape, hoisted;
- `TextSite`, `AttributeSite`, `PropertySite`, `EventSite`;
- `List { source, key, row: RenderPlan }`;
- `Conditional { branches: [test, RenderPlan][] }`;
- `ComponentCall { component, props: node bindings, slots }`;
- `Boundary { sources, pending, error }` for presentation policies.

Backends read only this tree and the graph. DOM, SSR and HTML emitters stop
looking at source syntax.

## 4. Optimizations as plan passes

Each pass has a precondition stated on the plan and a test that checks it:

- DOM-only list rows (today `row-eligibility.ts`);
- reason routing and pull plans;
- static template hoisting;
- direct children and content regions.

**Q:** which list optimizations do you consider essential to keep exactly, and which
can be re-derived? Keeping `bench/` numbers is the hard requirement.

## 5. Where the current code goes

| Current | New stage |
| --- | --- |
| `components/declarations`, `jsx/*`, `analysis/source-calls`, `dom/read-replay`, `dom/group-lowering`, `dom/router` | Normalize |
| `ast/*`, `context/*` scope helpers | Resolve |
| `analysis/*`, `mutation-analysis.ts`, `helper-summaries.ts`, `dom/read-rewriting.ts` facts | Graph |
| `planning/*`, `lists/*`, `components/return-plan.ts` | Plan |
| `dom/row-eligibility.ts`, `dom/instance-reasons.ts`, pull plans | Optimize |
| `dom/*` emission, `effects/emission.ts`, `cells.ts`, streaming | Emit |
| `linking/*` | Unchanged at first; feeds module summaries into Graph |

## 6. First slice

Readiness first, because it touches the most passes and is the user's top priority:

1. Build Resolve and Graph beside the existing pipeline (read-only, no emission).
2. Assert in tests that `pending(n)` from the graph matches what the old passes gate.
3. Switch readiness emission to read the graph; delete the gating code in the four passes.
4. Then refs (rule 4), then the render plan.

**Q:** is a server function call always a `Source`, or only GET server functions
(today non-GET calls in render are rejected)?
