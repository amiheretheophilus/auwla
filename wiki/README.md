# Compiler refactor wiki

Working notes for the compiler refactor. A new session should read these pages
first, in this order, then continue from `status.md`.

| Page | What it holds |
| --- | --- |
| [rules.md](rules.md) | The user's ground rules. Every change must satisfy them. |
| [status.md](status.md) | Branch state, what is done, what is verified, what is next. |
| [plan.md](plan.md) | The target architecture and the migration steps. |
| [design.md](design.md) | Draft design of the graph and render plan, with open questions. |
| [problems.md](problems.md) | Structural problems in the current compiler that the refactor removes. |
| [decisions.md](decisions.md) | Decisions made with the user, with the reason for each. |
| [open-issues.md](open-issues.md) | Known bugs, limitations and topics still to discuss with the user. |

## Keeping it current

- Update `status.md` at the end of every work session and after every commit.
- Record a decision in `decisions.md` when the user settles something, quoting them.
- Move an item from `open-issues.md` to `status.md` when it is fixed, naming the commit.
- Keep pages short. Code facts belong in the code; these pages hold intent and progress.
