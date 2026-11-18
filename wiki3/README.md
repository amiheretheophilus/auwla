# Auwla documents wiki

The working map for **Auwla documents**: Markdown files (`.auwla.md`) that use Auwla
components and values, compiled by the compiler like any other module. It is a new
authoring language, so it has its own wiki and spec, apart from `.auwla` itself.

| Track | Wiki |
| --- | --- |
| The compiler (the compiler) | [wiki/](../wiki/README.md) |
| `.auwla` (JSX+) | [wiki2/](../wiki2/README.md) |
| `.auwla.md` documents | this folder |

Documents reuse `.auwla`'s readers for everything inside a tag or a `{...}`, so their
attribute and expression rules are wiki2's spec, linked rather than copied. Work
not yet done across all three tracks is listed in [FINALIZE.md](../FINALIZE.md).

## Start a session

1. Read [AGENTS.md](../AGENTS.md) and [the ground rules](../wiki/rules.md).
2. Read [status.md](status.md): where the work stands and what is waiting on the user.
3. Read [decisions.md](decisions.md): what the user accepted, and what is still open.
4. Read [spec/README.md](spec/README.md) before changing syntax. The spec comes before
   the parser (DX-29); revise a provisional rule with its fixtures, never in code alone.
5. Read [architecture.md](architecture.md) before choosing where code goes.

## Pages

| Page | Owns |
| --- | --- |
| [architecture.md](architecture.md) | Why not MDX's compiler, the pre-scan/mask/emit pipeline, where code lives, the compiler change it needs |
| [spec/](spec/README.md) | Grammar, semantics, diagnostics and fixtures |
| [decisions.md](decisions.md) | Dated user decisions and open questions |
| [plan.md](plan.md) | Ordered slices and their acceptance |
| [status.md](status.md) | Handoff: current state, next action, what is unverified |

## Working agreement

- The model is MDX's (Markdown, top-level `import`/`export`, components in the flow,
  `{expr}`), with Auwla's syntax inside tags and braces and static output. A change to
  that model is a decision for the user, recorded in decisions.md.
- Research and proposals stay local files until the user accepts them; commit when the
  user asks.
- Keep the current names (`memo-dom:`, `mmd_*`, `memoized-dom/*`), as the other tracks do.
