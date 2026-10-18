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
