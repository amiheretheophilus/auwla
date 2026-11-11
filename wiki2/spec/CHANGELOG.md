# Spec revisions

## 0.1-draft, revision 3 — 2026-11-11

- User-directed G-ATTR/S-ATTR addition: `prop=name` accepts one host identifier
  and normalizes to `prop={name}`. `onClick=addTask` passes the function unchanged;
  native dispatch supplies its event. Existing expression/event timing is intact.
- Preserve exact identifier spans and generate only unmapped braces. Bare calls,
  members, operators and literals still need parentheses or existing JSX braces.
- Add PARSE-008 and ATTR-002. No existing fixture meaning or diagnostic code changes.

## 0.1-draft, revision 2 — 2026-11-11

- User-directed G-ATTR/S-ATTR extension: accept `prop=(expression)` alongside
  existing `prop={expression}`. Normalize to ordinary JSX with native evaluation
  and event timing; no implicit callback or `@event` feature is added.
- Preserve copied parentheses/expressions and leave generated braces unmapped.
  Existing refs and `.tsx` attribute grammar retain their existing behavior.
- Add PARSE-007, ERROR-006 and ATTR-001, plus JPX1008 for an unclosed outer
  attribute parenthesis. JPX1003 also covers unterminated literals in these values.

## 0.1-draft, revision 1 — 2026-11-11

- Establish a core extension spec before parser implementation, following the
  organization of the inspected JASX specification.
- Define lexical contexts, direct child expressions, quoted text and block-bodied
  conditional children, with JavaScript continuation and explicit separators at
  ambiguous boundaries as provisional draft choices.
- Define source-range/syntax-view, evaluation, diagnostics and conformance contracts.
- Reuse compiler-next's pipeline and existing refs, attributes, lists, reactivity
  and ownership. No replacement compiler or ref implementation is introduced.
- Add a fixture catalog and checks that distinguish current-JSX baseline evidence
  from future extended-syntax conformance.
- Leave direct loops/declarations/abrupt child statements, shorthand events,
  bindings, class/style conveniences and packaging for later decisions.
- Record DX-30 as planned authoring direction: configured backend `.auwla` files
  are ordinary nonreactive code and may import Express/backend packages;
  isomorphic support is later work. Core markup grammar and fixtures are unchanged.
- DX-31 clarifies the implementation boundary: separate `packages/jsx-plus`
  normalizes into the existing compiler-next public API. Initial package fixtures
  now execute; no existing compiler/runtime feature is copied or modified.
- Implementation hardening adds parser-only async/generator contexts, child
  expression chunks, cached conditional bodies, nested-markup tail ranges and
  additional JPX1003/1004/1007 checks. These repair implementation gaps under the
  existing rules; no normative grammar, fixture expectation or code is revised.
- Initial TypeScript content-mapper probe shares the normalizer and verbatim
  mappings. Real CLI/LSP diagnostics, ref rename and invalid/restore edits now
  have focused evidence. Reactive-flow typing/editor acceptance remain open;
  this changes no language rule or existing fixture expectation.
- The first paired TypeScript checking profile uses existing compiler analysis
  facts and complementary diagnostic regions, clearing the original four gaps;
  applied ref/state rename tests pass. Follow-up hardening includes receiving
  declarations/JSX names, validated seeds/body assignments, spread facts and
  deferred/immediate callbacks. All 34 flow targets pass, and body-assignment/
  generic-helper programs execute in both compiler modes. Broader
  flow/editor acceptance remains open. No normative grammar or original target
  expectation changes; checking-only scaffolding never reaches runtime output.

Subsequent revisions name the affected rule/fixture IDs, observable change,
reason, and whether an accepted user direction is being revised. Keep open
design choices visible while evolving the draft.
