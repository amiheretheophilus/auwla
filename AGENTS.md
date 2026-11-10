# Instructions for coding agents

Read this file first. For JSX+ prototyping on `prototype/jsx-plus`, continue at
`wiki2/README.md` and its short reading order. For the compiler rewrite, continue
at `wiki/README.md`. Both tracks follow `wiki/rules.md` and the user's latest
instructions.

## Repository: push only to `amiheretheophilus/auwla`

| Remote | Repository | Use |
| --- | --- | --- |
| `origin` | `https://github.com/amiheretheophilus/auwla` | **The only repository.** Push here. CI runs here. |
| `memo-exp` | `https://github.com/snrraptopack/memo-exp` | Old, read-only. Its push URL is disabled on purpose. |

- **Never push to `snrraptopack/memo-exp`**, and never re-enable its push URL. That
  account has a billing lock, so GitHub Actions does not run there, and work pushed
  there is lost to the project.
- **Never touch `snrraptopack/auwla`.** It is an unrelated old project with the same
  name.
- The `gh` CLI is logged in to both accounts. `amiheretheophilus` must be the active
  one (`gh auth status`). If it is not, run `gh auth switch -u amiheretheophilus`.
  Do not switch to `snrraptopack`.
- Remotes are local git config, not part of the repository. If yours differ from
  the table, set them to match before pushing.

## Work in progress

- The compiler is being rewritten on branch `compiler-rewrite`. The design is in
  `wiki/compiler/`, with one page per group of related files.
- JSX+ authoring is being explored on `prototype/jsx-plus`. `dx.md` holds the
  design discussion; `wiki2/` maps the prototype, decisions, checks and next slice.
  Prototype grammar and plan choices are revisable as evidence arrives. Keep
  accepted user direction distinct from provisional experiments and implemented
  behavior. Start with `wiki2/status.md`, not the rewrite's next unchecked phase.
- `wiki/rules.md` holds the user's ground rules. Every change must satisfy them.
- Everything about a compiler concept goes on its `wiki/compiler/` page and in
  its feature folder: rules, cases to test, known bugs. JSX+ concepts instead use
  their `wiki2/` page, linking to existing compiler behavior rather than copying
  it. Update both owning pages when a change crosses that boundary.
- Keep the current names (`memo-dom:`, `mmd_*`, `memoized-dom/*`). The rename to
  auwla happens later, across all packages at once.

## How to work

- Edit files with your editor tools, not with `sed`, scripts or shell redirection.
- The user's machine is slow and low on memory. Do not run the full root suite
  locally as a routine check; run the files you changed. The user allowed it for the
  Phase 10 acceptance work (`wiki/decisions.md`, 2026-11-06). Root tests import `dist`, so
  rebuild the package first (`bun run --cwd packages/<name> build`).
- `packages/compiler-next` tests import `src` directly and need no build.
- Test locally first: `bun check`, the touched feature's unit tests, and the case
  files a change affects. Only batches that are slow here (minutes, not
  milliseconds) go to GitHub Actions, started by hand:
  `gh workflow run compiler-next.yml --ref compiler-rewrite -f suite=<all|cases|reference|generators|unit>`.
  Use it at a phase exit or after changing shared machinery, not after every
  edit. Details: `wiki/compiler/testing.md`, "Where tests run".
- Type-check with `bun check` (in a package, or `bun check -p <tsconfig>`). It reports
  the same errors as `tsc` in under a second. Do not use `bunx tsc`.
- Benchmarks live in `bench/`. Run them locally only to check their correctness
  gates; the user times them on another machine.
- Commit and push after each finished step, to `origin`.
