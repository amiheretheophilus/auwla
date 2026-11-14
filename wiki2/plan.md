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
| P2-HARDEN | First slice built; ongoing | Generator/async fragments, semicolon-separated object/function/class children, nested-markup tails and selected error ranges checked; broader recovery and reparse costs remain | [syntax](syntax.md) |
| P2-ATTR | First slice built: draft 0.1 r2 | Optional parenthesized attribute values normalize to JSX with ordinary timing; real task-board labels/ref/callbacks, exact spans and native completion edits checked | [syntax](syntax.md), [grammar](spec/grammar.md#attributes-and-existing-refs-g-attr) |
| P2-ATTR-ID | Built: draft 0.1 r3 | Bare `prop=name` preserves a single host identifier and native event delivery; actual examples, boundaries, Unicode and applied handler rename checked | [syntax](syntax.md#bare-identifier-attributes) |
| P3-TOOL | First CLI/LSP probe built | Typed-prop/ref example, exact authored error range, four-use ref rename and recheck pass through pinned TypeScript; broader flow/editor/caching work remains | [tooling](tooling.md) |
| P3-FLOW | Catalog expanded | 34 actual LSP targets cover replay, deferred props, scope, receiving errors and host contexts; runtime guard examples pass in both modes | [checking flow](checking-flow.md) |
| P3-FACTS | First snapshot built | Public inspection shares compiler frontend; JSX+ maps identities/facts with explicit fidelity and refuses shifted coordinates; full replay proofs remain open | [checking flow](checking-flow.md#boundaries-and-next-work) |
| P3-PROJECT | First profile built | Paired native TS views clear the four original targets and preserve synchronous narrowing, guards, await/yield and applied renames across the twenty-case catalog | [checking flow](checking-flow.md) |
| P3-HARDEN | First hardening slice built | Receiving declaration/JSX contexts retain assignability errors; validated seeds/body assignments cover two-step dependencies, generic helpers and named deferred/immediate calls across 34 cases | [checking flow](checking-flow.md) |
| P3-CACHE | First slice built | One latest exact filename/content result per project; edits and file switches replace it, open/reopen starts fresh, close drops it; real-example reuse counts pass | [mapper cache](mapper-cache.md) |
| P3-EXAMPLES | First app built; expand with features | Author real `.auwla` files with a runnable preview and use those files in checks; task board exercises form/search/filter/list/ref/interpolation/conditional behavior in both modes | [examples](../packages/jsx-plus/examples/README.md) |
| P3-EDITING | First member-completion path built; continue | Native task-board attribute completion edit applies and rechecks; auto-import/broader edit fidelity and partial recovery remain next. Retain authored errors without stale successful text | [tooling](tooling.md) |
| P3-RECOVERY | Requested step built; structural follow-up built | Native host recovery, checking-only closers and bounded markup quarantine preserve current-source diagnostics/completion, including a repaired attribute; builds remain strict | [recovery](recovery.md) |
| P3-HANDLER-IMPORT | Done: requested step 2 | Imported bare handler runs in both modes. Native completion plus auto-import at the end of a bare attribute or child reproduces the authored file and rechecks; required end anchors in `checking/spans.ts` | [tooling](tooling.md) |
| P3-INTERPOLATION | Built (DX-37), spec r7; adapter 0.0.2 installed | Quoted `{expression}` text lowers to native templates. Counter execution, exact mappings, completion/hover/rename, empty and unfinished input, and embedded-code highlighting checked | [syntax](syntax.md#quoted-text-interpolation) |
| P3-EDITOR | First adapter/assets built and locally installed (DX-36); desktop acceptance open | Separate VS Code adapter builds from shared metadata, mapper contribution and TSX-derived grammar. Real tokenizer/mapper launch checks and simulated activation tests pass. Local VSIX and TypeScript 7 provider installed; verify desktop activation, inferred projects and standalone distribution next | [tooling](tooling.md#editor-extension-planned-p3-editor) |
| P4-DIRECT-FOR | Done: requested step 3, spec r5 | `for (const b of iterable) { children }` lowers to `Array.from`; fixtures, example, rename and both-mode execution checked | [syntax](syntax.md#direct-loops) |
| P4-FOR-FAST | Done (DX-34/35), `9620fb57` | Compiler-next shows the intrinsic `Array.from(items, row)` through compiled rows like `items.map(row)`. The task board's two direct loops compile to `_rowList.from(...)`, and both-mode identity is checked. Edits through destructured `entries()` bindings are shown (`4072c829`). A loop over a plain state list now gets the closed-list unchanged-row skip, through the same proof and emission as `.map` | [syntax](syntax.md#direct-loops) |
| P4-MODULES | Client app built (DX-39); server side next | `auwla` is a compiler-next source language. The notes example builds and runs through compiler-next's project, Bun plugin and Vite plugin (dev, hot update, build) with authored maps and errors. The team example checks routes, lazy route chunks (Bun and Vite), `$fetch`/`$track`, `$routed` and effects in both modes. Next: server functions, server-backed `$routed`/SSR, cross-file editor checks | [architecture](architecture.md), [status](status.md) |
| P4-FLOW | First fixtures built; expand later | Basic direct `if` and `.map()` fixtures execute; extend scope, owner/disposal and readiness interleavings before full flow acceptance | [syntax](syntax.md), [testing](testing.md) |
| P5-EVENT | Candidate | Settle event-expression meaning; demonstrate one ordinary handler and one shorthand with identical timing | [features](features.md) |
| CSS-0 | First contract written | Explicit global native CSS profile, lexical boundaries, delivery contract and CSS-001 through CSS-006 fixtures; scope defaults remain open | [CSS spec](spec/styles.md) |
| CSS-1 | Verified; checkpoint authorized | Extract native `<style global>` blocks through the generic language hook; existing compiler owns CSS assets/updates/delivery; shared CSS assistance and real authoring example | [styling](styling.md) |
| CSS-2a | First class-condition profile built | Full-property `@.class:value` clauses, native selector lowering/order, authored errors, native value completion/highlighting and real class-toggle example; scope/config choices remain separate | [class-condition spec](spec/style-conditions.md), [styling](styling.md) |
| CSS-2b | Planned | Named breakpoint configuration and compact/grouped conditions; aliases later. No Tailwind or CSS runtime | [CSS design](../dxcss.md) |
| CSS-3a | First slice built | Component/file scopes, explicit globals, same-file named/transitive `@use(path, id)`, static native selectors, real multi-file gallery and shared CSS assistance | [scope contract](spec/style-scopes.md), [styling](styling.md) |
| CSS-3b | Next | Cross-file named style source resolution, asset URL rebasing, cycles across modules and CSS-only watching through compiler-next; no JS execution or JSX+ project wrapper | [scope contract](spec/style-scopes.md) |
| P6-BIND | Candidate | Settle named text/checkbox bindings, write typing and handler order; show one form | [features](features.md) |
| P7-APP | Candidate | Run a small real app through editing, build, SSR/adoption and disposal; compare output and work with equivalent existing source | [architecture](architecture.md), [testing](testing.md) |

P2 and P3 are one feedback loop, not a requirement to finish the full parser before
trying the mapper. P4 can expose a grammar problem and send work back to P1.
Split any slice whose result cannot be reviewed as a small concrete example.

## Ready to work

For the active slice, write: the question it answers, a few input examples,
observable expected results, owning files (planned or real), dependencies and the
checks that could disprove it. Resolve only the decisions that slice needs.

The user now authorizes committing/pushing the native CSS foundation and
continuing; this supersedes the temporary no-commit instruction. Review the
narrow CSS-1 contract before extending it. The wider sequence and open questions remain in
[dxcss.md](../dxcss.md). Parser hardening stays available as a separate slice.

## Finished means

- The promised behavior or investigation has concrete evidence and recorded limits.
- The authored program and equivalent JavaScript/JSX agree where equivalent forms
  exist; mappings are checked where the slice transforms authored source.
- The concept page names the actual files, cases and unresolved questions.
- [status.md](status.md) names what passed, what did not run and the next useful step.
- The work is committed and pushed when authorized. A checkpoint can preserve unfinished work, but
  is labeled as such and does not mark its behavioral acceptance complete.
- Code is reviewed directly and relevant checks pass before pushing. The user's
  latest instruction supersedes the earlier another-agent review requirement.

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
