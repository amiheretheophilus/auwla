# Prototype backlog

Updated: 2026-11-10. Working order, revisable after every slice.

The goal is additional authoring features inside compiler-next's existing path,
with correct JavaScript behavior and credible tooling. Experiments use its parse,
resolve, graph, plan, optimize and emit stages. Existing refs are already built;
checking them under new syntax is compatibility work. Production adoption still
depends on integration, acceptance and measurements.

## Ordered slices

| ID | State | Outcome and acceptance | Owns details |
| --- | --- | --- | --- |
| P0-DOC | Done | Record the user directions; create the wiki and session route; validate links, paths and examples | [status](status.md), [decisions](decisions.md) |
| P0-ALIGN | Done | Make compiler-next continuity and existing ref support explicit; remove the standalone compiler-package suggestion | [architecture](architecture.md), [refs](refs.md) |
| P1-GRAMMAR | Next | Compare boundary/scoping candidates with concrete valid, ambiguous and incomplete fixtures; record a provisional grammar and remaining questions | [syntax](syntax.md) |
| P2-PARSE | Planned | Extend compiler-next's parse stage for quoted text/direct children; compile through the same later stages and verify existing refs still work | [syntax](syntax.md), [architecture](architecture.md), [refs](refs.md) |
| P3-TOOL | Planned; pair with P2 | A minimal mapper type-checks the same source, reports a deliberate error at the authored span, and supports a safe rename edit | [tooling](tooling.md) |
| P4-FLOW | Planned | Direct `if` and `.map()` preserve scope, evaluation order, keyed identity and ref cleanup against equivalent JSX | [syntax](syntax.md), [testing](testing.md) |
| P5-EVENT | Candidate | Settle event-expression meaning; demonstrate one ordinary handler and one shorthand with identical timing | [features](features.md) |
| P6-BIND | Candidate | Settle named text/checkbox bindings, write typing and handler order; show one form | [features](features.md) |
| P7-APP | Candidate | Run a small real app through editing, build, SSR/adoption and disposal; compare output and work with equivalent existing source | [architecture](architecture.md), [testing](testing.md) |

P2 and P3 are one feedback loop, not a requirement to finish the full parser before
trying the mapper. P4 can expose a grammar problem and send work back to P1.
Split any slice whose result cannot be reviewed as a small concrete example.

## Ready to work

For the active slice, write: the question it answers, a few input examples,
observable expected results, owning files (planned or real), dependencies and the
checks that could disprove it. Resolve only the decisions that slice needs.

The next grammar experiment needs no event modifiers, CSS system or production
Vite migration. A source-to-source experiment is an option to test, not a decision
to turn the whole language into string rewrites.

## Finished means

- The promised behavior or investigation has concrete evidence and recorded limits.
- The authored program and equivalent JavaScript/JSX agree where equivalent forms
  exist; mappings are checked where the slice transforms authored source.
- The concept page names the actual files, cases and unresolved questions.
- [status.md](status.md) names what passed, what did not run and the next useful step.
- The work is committed and pushed. A checkpoint can preserve unfinished work, but
  is labeled as such and does not mark its behavioral acceptance complete.

Documentation-only work uses link/path/example review and `git diff --check`.
Implementation uses the focused checks in [testing.md](testing.md).

## Revising the backlog

Keep stable IDs for discussion. Add, split, reorder, defer or replace slices as
we learn; record a short reason beside the affected slice or in its owning page.
When a user-facing decision changes, link the new [decision](decisions.md) and
update examples and checks together. No fixed sprint duration or full language
specification is required before a small experiment can begin.

Later candidates include conditional classes, styling, scoped CSS, gestures,
hotkeys, observers and ref-based DOM measurements. Their open contracts stay in
[features.md](features.md), not in an additional global bug list.
