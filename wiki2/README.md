# JSX+ prototype wiki

Branch: `prototype/jsx-plus`. Updated: 2026-11-10.

The working map for Auwla's authoring prototype. [dx.md](../dx.md) holds the design
discussion and feature index. This folder connects each experiment to its rules,
files, acceptance examples and evidence. Existing compiler/runtime contracts stay
in [wiki/compiler](../wiki/compiler/README.md).

**This is an extension of compiler-next.** JSX+ adds syntax and authoring features
beyond ordinary JSX through the same compiler pipeline. Refs, reactivity, lists
and ownership already exist; the prototype preserves them. `wiki2` maps the
extension work, not a replacement compiler or a second ref implementation.

## Start a session

1. Read [AGENTS.md](../AGENTS.md) and [the existing ground rules](../wiki/rules.md).
2. Read [status.md](status.md): current state, next slice and what is unverified.
3. Read [plan.md](plan.md): the ordered backlog and the next slice's outcome.
4. Read the owning concept page below. Use [decisions.md](decisions.md) when a
   choice's status or reason matters; use [architecture.md](architecture.md) when
   choosing where code belongs.

Check the actual branch and working tree first. The chat's default directory can
still be `learning`; execute project commands in the `auwla` checkout explicitly.

## Find a concept

| Page | Owns |
| --- | --- |
| [syntax.md](syntax.md) | Quoted text, direct expressions, control flow, separators, scopes and grammar recovery |
| [refs.md](refs.md) | Normally declared refs, the existing `ref` prop, lifecycle compatibility and code map |
| [tooling.md](tooling.md) | TypeScript content mapper, authored spans, diagnostics, editing and formatting |
| [features.md](features.md) | Proposed events, modifiers, bindings, classes, CSS and element behavior; extraction points for later pages |
| [architecture.md](architecture.md) | Current integration files, proposed boundaries, source-map flow and planned code |
| [testing.md](testing.md) | Verification strategy, evidence format and the limits of each check |
| [plan.md](plan.md) | Small work slices, dependencies and outcomes |
| [decisions.md](decisions.md) | Dated accepted directions and superseded choices |
| [status.md](status.md) | Concise handoff; latest evidence and the next useful action |

## Working agreement

- Use small slices: example, explicit hypothesis, implementation, checks, review.
  A slice should answer one useful question or demonstrate one usable behavior.
- The backlog is ordered, not frozen. Split, reorder or replace work when evidence
  changes the best next step. Record the reason in the current slice; do not keep
  following an obsolete phase just because it is numbered.
- Distinguish **accepted direction**, **provisional choice**, **implemented** and
  **verified**. An example, recommendation or checked documentation task is not
  evidence that the parser accepts it.
- An experiment can refine provisional grammar or file placement. Surface a
  change to accepted user-facing semantics and record why; the user's latest
  direction takes precedence. Being agile does not silently change JavaScript
  evaluation, reactivity or ref ownership.
- Each concept page owns its contract, open questions, cases and file map. Use
  links from the plan and status instead of duplicating bug lists or test counts.
- Change the owning page in the same commit as its code. Mark future paths
  **planned**, and replace them with actual paths when implemented.
- Keep status short. Record the latest verified commit and exact commands/results;
  superseded run history belongs in Git. Record failures and unchecked behavior.
- Commit and push finished slices to `origin` on the prototype branch. Do not
  merge or begin a package rename as part of the experiment.

## Revise a slice

State the observation, revise the owning example/rule and its acceptance check,
then update the backlog and handoff. A decision that is reversed gets a superseding
entry with its reason. Do not change a failing assertion merely to hide a bug;
identify whether the contract intentionally changed or the implementation is wrong.
