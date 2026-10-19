# Wiki

Notes for the compiler rewrite (branch `compiler-rewrite`). A new session reads
`../AGENTS.md` first, then these pages in this order, then continues from
`status.md`.

**Push only to `amiheretheophilus/auwla` (remote `origin`).** Never push to
`snrraptopack/memo-exp`: its account has a billing lock and CI cannot run there.

| Page | What it holds |
| --- | --- |
| [rules.md](rules.md) | The user's ground rules. Every change must satisfy them. |
| [compiler/](compiler/README.md) | The new compiler: pipeline, folders, and one page per group of related files. Each page also lists its cases to test. |
| [status.md](status.md) | Branch state, what is done, what is verified, what is next. |
| [decisions.md](decisions.md) | Decisions made with the user, with the reason for each. |
| [open-issues.md](open-issues.md) | Known bugs, limitations and topics still to discuss with the user. |

## Keeping it current

- Everything about one concept goes on its `compiler/` page: rules, files, cases to
  test, known bugs. Do not start a separate list elsewhere.
- A `compiler/` page changes in the same commit as the code it describes.
- Update `status.md` at the end of every work session and after every commit.
- Record a decision in `decisions.md` when the user settles something, quoting them.
- Move an item from `open-issues.md` to `status.md` when it is fixed, naming the commit.
- Keep pages short. Pages describe the code as it is now; history goes in git.
