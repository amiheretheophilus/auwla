# Prototype decisions

Updated: 2026-11-11. Accepted direction is separate from implemented support.

## Accepted directions

| ID | Date | Decision and evidence | Contract |
| --- | --- | --- | --- |
| DX-01 | Before this prototype | Use TypeScript content mappers; recorded in `dx.md`. Packaging and version-specific behavior still need a probe. | [tooling](tooling.md) |
| DX-19 | 2026-11-10 | Keep normal ref declarations and the existing `ref` prop. User: `the ref i want to matain the old way like normal variable decalration with the ref props nothing like "$"`. Supersedes the tag-declared ref proposal. | [refs](refs.md) |
| DX-25 | 2026-11-10 | Quote literal markup text; read expressions directly. User: `instead of having <div>text</div> why not <div>"text"</div>`. | [syntax](syntax.md) |
| DX-14 | 2026-11-10 | Explore direct control flow and ordinary expressions without an outer child-expression container. User: "if statments and stuff without {} and even real expression stuff like .map and stuff without these {}". JavaScript block/object braces retain their roles. Exact grammar is open. | [syntax](syntax.md) |
| DX-27 | 2026-11-10 | Create `wiki2` for the map and plan, and iterate as evidence arrives. User: "since it agile approach we are using we can make changes we go". | [plan](plan.md) |
| DX-28 | 2026-11-10 | Extend compiler-next through its existing pipeline with features ordinary JSX cannot express. Existing refs are reused. User: "this doesnt take a different path from the compiler next" and "the ref exists already". Supersedes the suggestion of a standalone prototype compiler package. | [architecture](architecture.md), [refs](refs.md) |
| DX-29 | 2026-11-11 | Define a language spec before implementing the syntax, informed by the organization of `snrraptopack/jasx`. User: "before they started they had a proper language spec". The spec remains a revisable draft under DX-27. | [spec](spec/README.md) |
| DX-30 | 2026-11-11 | `.auwla` may contain pure nonreactive backend code and ordinary backend imports such as Express. Config will select backend files/folders; isomorphic support comes later. User: "backends are not even reactive" and "we will have a config that will point to backend files or folder". Exact config syntax and implementation remain planned. | [architecture](architecture.md#backend-authoring-planned), [spec](spec/README.md#backend-authoring-direction-planned) |

## Provisional choices

- `.auwla` is the working extension, pending the parser/tooling experiment.
- Existing attribute expression braces stay in current examples. The user asked
  about children; no new attribute grammar has been accepted.
- Exact file placement and checking projection remain provisional. Production
  syntax support belongs in compiler-next's parse stage and feeds the same later
  stages. A TypeScript mapper may have its own transport/package boundary; it
  does not produce the application's runtime program.
- [Core spec revision 1](spec/grammar.md) provisionally preserves host continuation
  and ASI, uses explicit separators at ambiguous boundaries, treats quoted child
  strings as host strings without JSX entity decoding, and requires direct `if`
  bodies to be blocks. These are initial draft choices backed by fixtures, not
  final user acceptance of every grammar detail. Mandatory semicolons after every
  child have not been accepted. Direct child declarations/loops and outward
  completion semantics remain later design work.

These choices can be revised in a slice without pretending they were user decisions.

## Record a change

For a new accepted decision, add its date, the concrete behavior, the reason or
user wording, the concept-page link and any superseded decision. Preserve the
older reason when reversing a choice. Keep experiments and measurements on the
concept page; do not turn every implementation detail into a permanent decision.

The rest of [dx.md's decision register](../dx.md#17-decision-register) remains
open or recommended as labeled. Updating this wiki does not accept all those
features or change the established compiler reactivity rules.
