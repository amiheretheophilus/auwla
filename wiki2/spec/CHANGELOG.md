# Spec revisions

## 0.1-draft, revision 9 — 2026-11-14

- Diagnostics only; no accepted syntax or meaning changes. A `<` comparison is
  still never turned into a tag.
- Closes revision 8's gap. When the joined tag has the enclosing element's
  name, `<p>"a" <p>"b"</p></p>`, the first `</p>` closes the outer element and
  the last one failed later: a host regex error, or JPX1001 in a parent. Such a
  comparison is now a candidate. If the file fails after it, and inserting `;`
  before that `<` gets past the failure, the error is JPX1005 over its opening
  tag, with that `;` as the repair. The editor reports it too. Code that does
  not fail is never reported (`<b>x < b > y</b>`, `<b><b>x < b > y</b></b>`).
- An opening tag that meets a closing tag's `</` before its own `>`, such as
  `<section><Badg</section>` while typing, is an incomplete opening tag ending
  before that `</`. Before, the closer's `>` ended it, and the enclosing element
  was reported unclosed (JPX1002). Editor recovery closes it as ` />` for
  checking only.
- Add ERROR-018. Existing fixtures and codes are unchanged.

## 0.1-draft, revision 8 — 2026-11-13

- Diagnostics only; no accepted syntax or meaning changes. G-BOUNDARY rule 5
  still never turns a `<` comparison into a tag.
- JPX1005 (D-RECOVERY) also covers a tag with a body written after a text or
  expression child without `;`: `"Retry?" <button>"Retry"</button>`. The host
  reads `"Retry?" < button > ...` as a comparison, so the scan met `</button>`
  first and reported JPX1001 there. When that closer's name follows a `<` read
  as a comparison, and the text from that `<` to the closer reads as one whole
  element, the error is JPX1005 over that element's opening tag. A mismatch
  without such an element stays JPX1001.
- A fragment `<>` in the same position is JPX1005 over `<>`, with the separator
  message instead of the host's.
- Not covered: when the joined tag has the enclosing element's own name
  (`<p>"a" <p>"b"</p></p>`), the first `</p>` closes the outer element and the
  comparison is valid host code, so the stray closer is reported later.
- Add ERROR-016 and ERROR-017. Existing fixtures and codes are unchanged.

## 0.1-draft, revision 7 — 2026-11-11

- DX-37: quoted child text supports `{expression}` substitutions (G-INTERP,
  S-INTERP), lowered to native templates. This reserves unescaped `{` at child
  level; use `\{` for literal text. Ordinary nested host strings and attributes
  retain their existing rules; native backticks still use `${...}`.
- Substitution strings, comments, regexes and nested delimiters use host tokens.
  String coercion, evaluation order and reactivity follow native templates.
- The small syntax view retains an Expression's complete authored spelling;
  generated template punctuation is unmapped and copied expressions stay exact.
- New JPX1012 (missing interpolation closer) and JPX1013 (empty interpolation),
  both at the opening `{`. Add PARSE-010, ERROR-014/015 and TEXT-004.

## 0.1-draft, revision 6 — 2026-11-11

- Diagnostics only; no accepted syntax or meaning changes. Inputs that were
  already rejected now get an error at their actual cause, found while making
  editor recovery handle half-finished edits.
- New JPX1011 (G-FOR, D-RECOVERY): a child `if`/`for` header `(` with no `)`,
  at the `(`. Previously the scan ran to the end of input and reported the
  surrounding element as unclosed (JPX1002).
- JPX1001 also covers an incomplete closing tag (`</p` with no `>`), ranged from
  `</` through its name. Previously the reader took a later tag's `>` and name.
- JPX1009 also covers an empty value before `>` (`<input value=>`), at the `>`.
  Previously `=>` lexed as one token and the tag ran on to a later `>`.
- A host error from an unclosed attribute `{` is reported at that `{`, not over
  the rest of the file.
- Add ERROR-011, ERROR-012 and ERROR-013. Existing fixtures and codes are unchanged.

## 0.1-draft, revision 5 — 2026-11-11

- User-requested direct loops (step 3; DX-35). New G-FOR/S-FOR: a child-level
  `for (const binding of iterable) { children }` with any binding pattern. The
  body holds child items only, like `if` blocks.
- Lowering is `{Array.from(iterable, (binding) => row)}`. A body that is one
  element or fragment is the row, so its `key` is the row key; otherwise it is
  one fragment per iteration. Any iterable works.
- Stated deviations: `await`/`yield` in a loop body are errors (it is a callback
  in the normalized program); a non-iterable array-like is read by index; a local
  `Array` binding is unsupported. The earlier "no hidden function wrapper" rule
  still holds: this callback is specified, not hidden.
- New JPX1010 for other loop forms (`let`/`var`, no declaration, `for...in`,
  C-style, `for await`). JPX1006 now also covers a non-block loop body.
- G-BOUNDARY rule 4 extended: after complete markup, a direct `if`/`for` on the
  same line starts a sibling. Previously `<li/> if (x) {...}` on one line reported
  a misleading JPX1007.
- New `Loop` syntax-view node in ast.md and ast.schema.json. Add PARSE-009,
  ERROR-009, ERROR-010, FOR-001 (keyed reorder keeps nodes) and FOR-002 (a `Set`
  iterable with per-iteration closures).

## 0.1-draft, revision 4 — 2026-11-11

- Diagnostics only; no accepted syntax or meaning changes. Inputs that were
  already rejected now get a JSX+ code and a repair instead of a raw host message.
- New JPX1009 (G-ATTR): an undelimited attribute value that is not one host
  identifier, such as `onClick=handlers.add`, `value=true` or `onClick=addTask()`.
  It is ranged over the value. Plain JSX has no valid undelimited value.
- JPX1005 (G-CORE) also covers a top-level comma operator used as a child,
  ranged over the first comma. The grammar already required its parentheses.
- Add ERROR-007 and ERROR-008. Existing fixtures and codes are unchanged.

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
