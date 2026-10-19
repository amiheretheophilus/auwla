# Wiki

Notes for the compiler rewrite (branch `compiler-rewrite`). A new session reads
these pages first, in this order, then continues from `status.md`.

| Page | What it holds |
| --- | --- |
| [rules.md](rules.md) | The user's ground rules. Every change must satisfy them. |
| [compiler/](compiler/README.md) | The new compiler: pipeline, folders, and one page per group of related files. |
| [status.md](status.md) | Branch state, what is done, what is verified, what is next. |
| [decisions.md](decisions.md) | Decisions made with the user, with the reason for each. |
| [rejections.md](rejections.md) | Valid JavaScript the old compiler rejects; each one becomes a test. |
| [open-issues.md](open-issues.md) | Known bugs, limitations and topics still to discuss with the user. |

## Keeping it current

- A `compiler/` page changes in the same commit as the code it describes.
- Update `status.md` at the end of every work session and after every commit.
- Record a decision in `decisions.md` when the user settles something, quoting them.
- Move an item from `open-issues.md` to `status.md` when it is fixed, naming the commit.
- Keep pages short. Pages describe the code as it is now; history goes in git.
