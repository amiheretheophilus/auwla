# Prototype backlog

Updated: 2026-11-11. Working order, revisable after every slice.

The goal is additional authoring features in the separate `packages/jsx-plus`
package, with correct JavaScript behavior and credible tooling. Normalized TSX
uses compiler-next's public API and existing production stages. Existing refs are already built;
checking them under new syntax is compatibility work. Production adoption still
depends on integration, acceptance and measurements.

## Ordered slices

| ID | State | Outcome and acceptance | Owns details |
| --- | --- | --- | --- |
| P0-DOC | Done | Record the user directions; create the wiki and session route; validate links, paths and examples | [status](status.md), [decisions](decisions.md) |
| P0-ALIGN | Done | Make compiler-next continuity and existing ref support explicit; DX-31 subsequently places syntax in a separate package using the same compiler | [architecture](architecture.md), [refs](refs.md) |
| P1-SPEC | Done: draft 0.1 r1 | Study JASX's spec organization; define core grammar, syntax model, semantics, diagnostics and conformance fixtures before parser work | [spec](spec/README.md) |
| P1-GRAMMAR | Done: provisional candidate | Host-parser probes establish continuation behavior; record concrete boundaries and incomplete-input fixtures, now exercised by P2 | [grammar](spec/grammar.md), [syntax](syntax.md) |
| P2-PARSE | First slice built | Separate syntax package normalizes the current parse/error/behavior fixtures with copied-span mappings; the UI facade calls compiler-next | [syntax](syntax.md), [architecture](architecture.md), [refs](refs.md) |
| P2-HARDEN | Next | Expand host-context, malformed-input and mapping cases; address scanner reparse costs and document measured limits before broader integration | [syntax](syntax.md) |
| P3-TOOL | Planned; pair with P2 | A minimal mapper type-checks the same source, reports a deliberate error at the authored span, and supports a safe rename edit | [tooling](tooling.md) |
| P4-FLOW | First fixtures built; expand later | Basic direct `if` and `.map()` fixtures execute; extend scope, owner/disposal and readiness interleavings before full flow acceptance | [syntax](syntax.md), [testing](testing.md) |
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

The next parser slice hardens the declared core subset in the separate package and
reports exactly which conformance levels/fixtures it covers. It needs no event
modifiers, CSS system or production Vite migration. Normalization in the syntax
package uses the host tokenizer/parser; it does not replace host parsing with
string rewrites. Pair hardening with source-range and mapper probes early.

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
specification for every future feature is required. The current slice does need
explicit draft rules and fixtures before its parser behavior is implemented.

Later candidates include conditional classes, styling, scoped CSS, gestures,
hotkeys, observers and ref-based DOM measurements. Their open contracts stay in
[features.md](features.md), not in an additional global bug list.

Backend roadmap note (DX-30): configuration will identify backend `.auwla` files
and/or folders, where ordinary nonreactive backend code may import Express and
other backend packages. Config syntax/loading work is planned; isomorphic support
comes later. This does not change the current P2 markup-parser priority. See
[architecture.md](architecture.md#backend-authoring-planned).
