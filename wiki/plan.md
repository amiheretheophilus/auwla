# Refactor plan

The user: "i need a massive refactor not just some pattern". The current compiler
handles each concept in several passes that mutate one AST; the refactor replaces
that with a pipeline of explicit, immutable stages.

## Target pipeline

1. **Parse and normalize.** One pass that produces a normalized AST (for example,
   early returns become one conditional return). No later stage edits syntax.
2. **Resolve.** One symbol table for the module, built once and never refreshed.
   Facts are keyed by symbol, not by AST node identity, so cloning cannot lose them.
3. **Semantic graph per component.** Nodes: state, props, sources, derivations,
   seeds, effects, handlers, render sites. Edges: "reads". Reactivity and
   readiness are rules over this graph:
   - a node is reactive if it reads something that can change;
   - a node waits while any source it transitively reads is loading;
   - what cannot be proven is an opaque node, handled conservatively.
4. **Render plan.** Regions, sites, lists and conditionals, built from the graph.
5. **Backends.** DOM, SSR and HTML emit from the render plan only. They never
   look at the source AST or re-derive facts.
6. **Optimizations.** Separate passes over the render plan, each with its own
   proof that it preserves behaviour (list fast paths, reason routing, static hoisting).

## Migration

- Strangler approach: build the new stages beside the old ones and move one concept
  at a time (readiness first, since it touches the most passes).
- Contract: the existing suites (root `tests/`, package tests, `bun run test:vite`,
  the Conduit flows). Compare runtime behaviour, not emitted text.
- Delete an old pass as soon as nothing reads its facts.
- Keep `bench/` list numbers at or above the current level.

## Steps

- [ ] Design document for user review (graph node kinds, edge rules, plan shape).
- [ ] Symbol table stage with no `refresh()`.
  - [x] Freeze: analysis reads one index, checked at thaw (`8c40eb9`).
  - [ ] Symbols with ids on the frozen index; facts keyed by symbol, not name.
- [ ] Semantic graph built from the symbol table; readiness computed on it.
- [ ] Port readiness emission to read the graph (replaces read-rewriting gating).
- [ ] Render plan; port DOM backend.
- [ ] Port SSR and HTML backends.
- [ ] Move optimizations into plan passes.
