# Instructions for coding agents

Read this file first. Then read `wiki/README.md`, which lists the rest in order.

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
- `wiki/rules.md` holds the user's ground rules. Every change must satisfy them.
- Everything about one concept goes on its `wiki/compiler/` page and in its feature
  folder: rules, cases to test, known bugs. Do not start separate lists.
- Keep the current names (`memo-dom:`, `mmd_*`, `memoized-dom/*`). The rename to
  auwla happens later, across all packages at once.

## How to work

- Edit files with your editor tools, not with `sed`, scripts or shell redirection.
- The user's machine is slow and low on memory. Never run the full root suite
  locally; run the files you changed. Root tests import `dist`, so rebuild the
  package first (`bun run --cwd packages/<name> build`).
- `packages/compiler-next` tests import `src` directly and need no build.
- The slow compiler-next checks run on GitHub Actions
  (`.github/workflows/compiler-next.yml`), not locally: every case on the
  reference, every case on compiler-next (`scripts/phase-gate.ts`: each failure
  must name its phase), and the generators at 200 programs. They finish in about
  a minute there, against about 20 minutes on the user's machine. Push, then
  `gh run watch <id> --exit-status`. Locally, run only the files a change affects.
- Type-check with `bun check` (in a package, or `bun check -p <tsconfig>`). It reports
  the same errors as `tsc` in under a second. Do not use `bunx tsc`.
- Benchmarks live in `bench/`. Run them locally only to check their correctness
  gates; the user times them on another machine.
- Commit and push after each finished step, to `origin`.
