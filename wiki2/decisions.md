# Prototype decisions

Updated: 2026-11-10. Accepted direction is separate from implemented support.

## Accepted directions

| ID | Date | Decision and evidence | Contract |
| --- | --- | --- | --- |
| DX-01 | Before this prototype | Use TypeScript content mappers; recorded in `dx.md`. Packaging and version-specific behavior still need a probe. | [tooling](tooling.md) |
| DX-19 | 2026-11-10 | Keep normal ref declarations and the existing `ref` prop. User: `the ref i want to matain the old way like normal variable decalration with the ref props nothing like "$"`. Supersedes the tag-declared ref proposal. | [refs](refs.md) |
| DX-25 | 2026-11-10 | Quote literal markup text; read expressions directly. User: `instead of having <div>text</div> why not <div>"text"</div>`. | [syntax](syntax.md) |
| DX-14 | 2026-11-10 | Explore direct control flow and ordinary expressions without an outer child-expression container. User: "if statments and stuff without {} and even real expression stuff like .map and stuff without these {}". JavaScript block/object braces retain their roles. Exact grammar is open. | [syntax](syntax.md) |
| DX-27 | 2026-11-10 | Create `wiki2` for the map and plan, and iterate as evidence arrives. User: "since it agile approach we are using we can make changes we go". | [plan](plan.md) |

## Provisional choices

- `.auwla` is the working extension, pending the parser/tooling experiment.
- Existing attribute expression braces stay in current examples. The user asked
  about children; no new attribute grammar has been accepted.
- Shared parser, separate runtime/checking outputs and a small isolated prototype
  package are architectural recommendations to validate, not implemented facts.
- Separator, whitespace, entity, declaration and statement-completion rules are
  open. In particular, mandatory semicolons have not been accepted.

These choices can be revised in a slice without pretending they were user decisions.

## Record a change

For a new accepted decision, add its date, the concrete behavior, the reason or
user wording, the concept-page link and any superseded decision. Preserve the
older reason when reversing a choice. Keep experiments and measurements on the
concept page; do not turn every implementation detail into a permanent decision.

The rest of [dx.md's decision register](../dx.md#17-decision-register) remains
open or recommended as labeled. Updating this wiki does not accept all those
features or change the established compiler reactivity rules.
