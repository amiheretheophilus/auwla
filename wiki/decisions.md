# Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-10-18 | Do a full compiler restructure, not targeted patches. | User: "i need a massive refactor not just some pattern"; the codebase is "too error prone". |
| 2026-10-18 | Merge `codex/package-conditional-sync` (`9e35480`) into `compiler-refactor` before the refactor. | User: so "the other branch" does not "have difficult" later. |
| 2026-10-18 | Commit failing tests as they are; never edit a failing case to pass. | User: "commit dont edit your failing tests cases". |
| 2026-10-18 | Reactivity comes from dependencies, not `let`/`const` or method lists; opaque fallback; no try/catch. | User's ground rules, see `rules.md`. |
| 2026-10-18 | Readiness is the top priority among bugs. | User: "what needs me the most is the readiness bug". |
| 2026-10-18 | Run heavy test suites on a pay-per-use remote machine (GitHub Codespaces suggested). | The local machine is slow and runs out of memory on the full suite. |
| 2026-10-18 | Roadmap features are discussed separately with the user before any work. | User is the domain expert: "i am skeptics if you indeed have the needed knowledge which i can give". |
| 2026-10-18 | The agent leads the refactor. | User: "you are in charge now". |
| 2026-10-18 | Refs: a ref read updates on mount and when the element is replaced; not on resize. | Resize needs a ResizeObserver per read; that is an explicit opt-in, not a default. |
| 2026-10-18 | Lists: every current list optimization stays until a plan pass reproduces it; `bench/` numbers are the gate. | List performance is a stated requirement. |
| 2026-10-18 | Only GET server functions are sources in render; other server functions are actions (still rejected in render). | Matches the current rule; a mutation must not run because a component rendered. |
| 2026-10-18 | Refactor slices verify by differential compilation (corpus diff) plus the test suites. | Behaviour is the contract; the diff shows every changed output for review. |
| 2026-10-18 | A mount-time ref update lands at the end of the creating task, not synchronously inside creation. | The owner is still creating its nodes; updating it then reads bindings that do not exist yet. Updates inside a commit stay synchronous. |
| 2026-10-18 | A written `const` is state like a written `let`; a method chain on an array literal is ordinary state once written. Optimization facts (static lists) never reject code. | User rules: reactivity does not depend on `let`/`const` ("this is not svelte"); normal JavaScript compiles. |
