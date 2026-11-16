# Finalize

Work not yet done, from the compiler to JSX+, kept in one place while the `.auwla.md`
documents feature is under way, so none of it is forgotten. Started 2026-11-16.

Each item says where its details live. Tick an item when it is done, naming the commit,
and remove it once the owning wiki records it as done.

## compiler-next

- [ ] **Incremental updates.** Every hot update recompiles the whole program: about 410 ms for
  Common Ground after the 2026-11-16 speedups (was about 480 ms), and saves made during a build now
  share one more build. Reusing unchanged modules' output needs cross-module fact dependencies
  tracked first (imports and importers both). [project.md, "Hot replacement"](wiki/compiler/project.md)
- [ ] **Acceptance**: root `tests/`, package tests, the Vite suite and the Conduit flows against
  compiler-next through a switch. [compiler plan](wiki/compiler/plan.md)
- [ ] **Benchmarks** on the user's VM; every number at least matches `d6e678b`.
- [ ] **Exit**: delete `packages/compiler`, rename compiler-next, drop the old-only runtime and tool
  code, update `docs/` (props, `$snapshot`, the old error messages). [compiler plan](wiki/compiler/plan.md)
- [ ] Follow-ups noted along the way: lazy css-tree loading; rule A for deferred statements;
  progressive interactive server pages (islands); plain `.css` imports in server pages; `miniflare`
  is only a transitive dependency; the `$routed` repro needs the user's source.
- [ ] **Bug: state kept in a module-level Map, read through a snapshot.** A Jotai-shaped library
  (`const values = new Map()`; `useAtom(key)` sets `values` on first use and returns
  `[values.get(key), set]`, where `set` calls `values.set(key, …)`); two components each run
  `const [n, setN] = useAtom(countAtom)`. Clicking `setN` in one updates the other component but
  not itself. With the Map filled when the atom is made instead, neither updates. Found 2026-11-16
  in an ergonomics run where 11 of 13 framework-style patterns worked (getter state, useReducer,
  Vue ref/reactive, Svelte and Redux subscribe, Solid path setter, MobX class, Zustand selector,
  Preact-signal accessors, async handlers, object getters). Two causes, diagnosed 2026-11-16:
  - **A, bug: an edit counts as a static read.** `const countAtom = atom(0)` where `atom()` runs
    `values.set(key, initial)` (or `values.push(x)`) gets `_from !== _valuesVersion` in the module's
    refresh (`core/graph/inputs.ts`, `inputsOf`: the identifier `values` is a value read, and the
    one version counter also moves on content edits). Every later edit of `values` re-runs
    `atom(0)`, which makes a new key holding 0, so nothing seems to update. The runtime already
    follows "edits are not reads" (`handlers.md`); the static inputs do not. Fix: a binding used
    only as the root of an edit (a store, a known editing call, and `Map`/`Set` editing methods on
    a binding provably holding one) is no static input. Needs the full case suite.
  - **B, decision: a derivation drops what it edits.** On first use `useAtom` writes `values`, so
    the statement of the component that ran it first loses its dependency on `values`
    (`publishVersions` → `noteOwnOutput` for whatever computation is running, even one in
    another module). Keeping it would make that statement follow the Map, but would also make an
    initializer such as `const id = registry.register(name)` register again whenever anything
    else registers. Effects already keep what they edit; derivations drop it so `s = s || {}`
    never replays (`effects.md`). The user decides; one option is to drop only what the statement
    assigns (its own bindings) and keep what it edits elsewhere.
- [ ] **Recompute code for statements that cannot change.** `const [a, setA] = state(1)` becomes a
  body statement with a re-run branch in `_update` (the `_recompute`/`_propagate` loop and
  `([a, setA] = state(1))`), though `state(1)` reads nothing that changes: about 60 dead lines in
  the 2026-11-16 `state()` stress test. Leave the branch out when the statement reads nothing
  reactive; only with output and behaviour unchanged elsewhere.
- [ ] **Decision: state made from a prop.** `const [a, setA] = state(props.start)` runs again when
  `start` changes, so the state starts over ("body statements run again", 2026-11-15). React's
  `useState` would keep it. The user decides which this pattern means.
- [ ] Decisions waiting on the user: running authored code at build time for static pages;
  uncompiled code editing data outside compiled calls; adoption detaching nodes (iframes reload).
  [open-issues.md](wiki/open-issues.md)

## `.auwla` (JSX+)

- [ ] **`@` events** for every event, with basic modifiers inline and the rest (`.log`, `.if`,
  `.debounce`, …) in a separate package; `.log` always prints. Spec first. [DX-53](wiki2/decisions.md)
- [ ] **Class shorthand** `<div.card.active>`, merged with `class`; `<Card.featured>` passes
  `class`. Spec first. [DX-53](wiki2/decisions.md)
- [ ] **Open question**: `{a}` as shorthand for `a={a}`.
- [ ] Remaining wiki2 slices: event expressions (P5-EVENT), bindings (P6-BIND), a full app through
  edit/build/SSR/adoption/disposal (P7-APP), server functions and SSR in `.auwla` (P4-MODULES),
  broader recovery and flow (P2-HARDEN, P4-FLOW). [wiki2 plan](wiki2/plan.md)
- [ ] **Reconcile the DX-34 compiler-next changes** made on this branch with `compiler-rewrite`.
  [wiki2 status](wiki2/status.md)

## `.auwla.md` documents

- [ ] Decisions: the micromark dependencies, the prose brace rule, metadata, the comment form.
  [wiki3 decisions](wiki3/decisions.md#open)
- [ ] Slices 1–7: spec settled, parser and emitter, elements and values, built-in language,
  headings and code highlighting, editor, the docs site. [wiki3 plan](wiki3/plan.md)
- [ ] Delete the root `mdx-research.md` draft once the user no longer needs it.

## Router and runtime

- [ ] **Scroll restoration** not reproduced: back restores in Edge with and without the Navigation
  API, after hot updates and typing. Needs the user's browser and how they go back (button, mouse
  side button, touchpad swipe, Alt+←). A sideways wheel no longer cancels a restore (`00d80372`).
- [ ] **Base path on the server**: client routing, links and server-rendered routes work below
  Vite's `base` (2026-11-16); server function endpoints (`/_fn/…`) and the server's own mounting
  below a base do not yet. [routes.md, "Base path"](wiki/compiler/routes.md)

## Tooling, editor, CI

- [ ] **Editor after parser changes**: VS Code's TypeScript server keeps the `.auwla` mapper it
  started, so it must be restarted after a JSX+ change. Consider restarting the mapper when JSX+
  changes, or documenting it.
- [ ] Editor extension: desktop activation, inferred projects and standalone distribution
  (P3-EDITOR); auto-import and broader edit fidelity (P3-EDITING). [wiki2 plan](wiki2/plan.md)
- [ ] **CI without `gh`**: the work machine cannot install `gh`. Trigger runs with `curl` and a
  token (the user chooses which), or put the workflow file on `main` (only if the user asks).
- [ ] CI on GitHub Actions once the suite reaches thousands of cases; devtools are on hold.
- [ ] **The auwla rename** across all packages, at once (`memo-dom:`, `mmd_*`, `memoized-dom/*`).
