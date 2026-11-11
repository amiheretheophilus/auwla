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

Subsequent revisions name the affected rule/fixture IDs, observable change,
reason, and whether an accepted user direction is being revised. Keep open
design choices visible while evolving the draft.
