# Spec revisions

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

Subsequent revisions name the affected rule/fixture IDs, observable change,
reason, and whether an accepted user direction is being revised. Keep open
design choices visible while evolving the draft.
