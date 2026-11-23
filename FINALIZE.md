# Finalize

Work not yet done, from the compiler to JSX+, kept in one place while the `.auwla.md`
documents feature is under way, so none of it is forgotten. Started 2026-11-16.

Each item says where its details live. Tick an item when it is done, naming the commit,
and remove it once the owning wiki records it as done.

## Compiler

- [ ] **Incremental updates.** Every hot update recompiles the whole program: about 410 ms for
  Common Ground after the 2026-11-16 speedups (was about 480 ms), and saves made during a build now
  share one more build. Reusing unchanged modules' output needs cross-module fact dependencies
  tracked first (imports and importers both). [project.md, "Hot replacement"](wiki/compiler/project.md)
- [ ] **Exit first** (the user, 2026-11-17): delete `packages/compiler` and the old Vite plugin,
  rename compiler-next to `packages/compiler`, drop the old-only runtime and tool code, update `docs/` (props, `$snapshot`,
  the old error messages, no conditional attributes). Seven steps, 1–2 done.
  [compiler plan](wiki/compiler/plan.md), Phase 10 "Exit"
- [ ] **Acceptance**, after the exit: the Vite suite read again on the one plugin (first run
  2026-11-16 in [testing.md](wiki/compiler/testing.md), "Acceptance"), the package tests and the
  Conduit flows (dependencies installed; the flow now finds Edge). Still missing from it:
  `.memoized/server-config.d.ts` (service and request-state types) in the compiler.
- [ ] **Benchmarks** on the user's VM; every number at least matches `d6e678b`.
- [ ] **Bundle trimming the old compiler did** (`bun run bench:size:audit`, "Trimming targets"):
  client-only counters and lists still bundle the optional hydration recovery
  (`hydration-error`), and fixed fetched pages the optional request replay.
- [ ] Follow-ups noted along the way: lazy css-tree loading; rule A for deferred statements;
  progressive interactive server pages (islands); plain `.css` imports in server pages; `miniflare`
  is only a transitive dependency; the `$routed` repro needs the user's source.
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
- [ ] **Declarations in a `for`/`if` child block** (`for (const s of sections) { const current = …;
  <a …/> }`). Outside the core profile ([grammar.md](wiki2/spec/grammar.md), G-FOR; deferred in
  [semantics.md](wiki2/spec/semantics.md)), and a porting app hit it at once (2026-11-23). Decide
  what such a `const` means (a per-iteration derived value that updates like a component's?), spec
  it with fixtures, no IIFE. Until then the diagnostic is poor: generic `HOST` "outside the initial
  JSX+ core profile" (`markup/children.ts`); it should name the rule and the fixes (compute before
  the loop, or move the row into a component).
- [ ] Remaining wiki2 slices: event expressions (P5-EVENT), bindings (P6-BIND), a full app through
  edit/build/SSR/adoption/disposal (P7-APP), server functions and SSR in `.auwla` (P4-MODULES),
  broader recovery and flow (P2-HARDEN, P4-FLOW). [wiki2 plan](wiki2/plan.md)
- [ ] **Reconcile the DX-34 compiler changes** made on this branch with `compiler-rewrite`.
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
- [ ] CI on GitHub Actions once the suite reaches thousands of cases.
- [ ] **Devtools rewrite.** The old `packages/devtools` inspector was removed (2026-11-23) to be
  rewritten. The runtime and data diagnostics still emit to the `memoized-dom:diagnostics:v1` hook.
- [ ] **Runtime trace diagnostics** (waits for the devtools rewrite): the compiler's development output does
  not call the runtime's trace hooks (`runtime/src/diagnostics.ts`), which the old compiler did.
  `packages/vite/tests/cli.test.ts` skips its trace test until the project emits them.
- [ ] **The auwla rename** across all packages, at once (`memo-dom:`, `mmd_*`, `memoized-dom/*`).
