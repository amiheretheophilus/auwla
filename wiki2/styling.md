# Native CSS implementation

Updated: 2026-11-15. Native CSS-1, class conditions (CSS-2a), local scopes (CSS-3a)
and cross-file reuse/implicit nesting (CSS-3b) are implemented. [dxcss.md](../dxcss.md) holds the
wider design; [spec/styles.md](spec/styles.md), [class conditions](spec/style-conditions.md)
and [scope rules](spec/style-scopes.md) own the implementation contracts.
[style-reuse.md](spec/style-reuse.md) extends source linking and nesting.
[style-responsive.md](spec/style-responsive.md) defines numeric viewport clauses.
[style-groups.md](spec/style-groups.md) extends them with numeric groups.
[style-editor-sources.md](spec/style-editor-sources.md) defines source-aware editor assistance.

## Authoring

Use `<style>` for local rules, `<style global>` for explicit globals, and
module-level `<style id="name">` definitions with `@use(path, id)` consumers.
Write ordinary CSS, including
custom properties, selectors, pseudo-classes, media queries, imports and URLs.
Several blocks form one stylesheet in authored order. No CSS declarations are
evaluated as JavaScript. A declaration directly in a component body is private;
file-level rules are shared within that file. A returned DOM style
element still follows the existing template child grammar.

`examples/styling/App.auwla` includes native responsive rules and a `.loading`
class selector. Its handler changes the class through existing compiler behavior.
`main.ts` uses the established API, `mount('app', App)`; the real entry executes in
both compiler modes in tests. `reset.css` and `dot.svg` exercise native relative
imports and asset URLs. Run its preview on port 3033, or add `--build`. The preview
passes HTML to Bun so the bundler creates CSS/script links itself.

## Ownership and files

| Owner | Files and contract |
| --- | --- |
| JSX+ syntax | `src/styles/blocks.ts` and `placement.ts` use host tokens and a neutral statement probe to distinguish module/function declarations from ordinary markup. The CSS delimiter scanner respects comments, strings and escapes. `src/normalize.ts` blanks declarations and preserves host mappings. `src/language.ts` passes static stylesheet text to the compiler hook. |
| Local scope/reuse | `src/styles/uses.ts` parses `@use`, checks module-local IDs and cross-file cycles, and retains authored offsets while expanding definitions. `scopes/markers.ts` consumes compiler-owned `inspectMarkup()` facts and inserts static attributes with `source.ts`; `scopes/selectors.ts` adds zero-specificity subject selectors. Syntax/selector rules remain here; compiler/runtime reactivity does not change. |
| Document subjects | `scopes/subjects.ts` keeps explicitly selected `html`, `body` and `:root` reachable, scopes ordinary alternatives/descendants, and carries proven document targets through nested `&`. `selectors.ts` preserves order around nested declaration groups. |
| Cross-file linking/nesting | `styles/stylesheet.ts` supplies pure compiler-owned recipes; `uses.ts` expands selected IDs from resolver-provided text and retains foreign authored spans; `urls.ts` rebases resource tokens. `styles/syntax.ts` extends CSS Tree block dispatch for implicit nesting and is shared by uses, conditions and scope. It reuses CSS Tree's selectors, declarations, at-rules and tokens. |
| Compiler assets | Compiler-next's `core/parse/languages.ts` appends the side-effect CSS import after authored host code, preserving directives/shebang positions. Parsed/resolved modules retain the companion. `pipeline.ts` exposes `css` separately in detailed results; `project/project.ts` compares JS and CSS in updates. |
| Existing delivery adapters | Compiler-next's `project/bun.ts` resolves and loads the virtual CSS companion with Bun's CSS loader. Vite's existing `next/plugin.ts` loads it before native CSS processing, including from static HTML whose script was removed. No JSX+ project wrapper/plugin is introduced. |
| Shared assistance | `src/styles/tooling.ts` uses `vscode-css-languageservice` over an equal-width CSS projection. `styles/recovery.ts` keeps missing-colon errors on unfinished property names and reparses to avoid errors cascading into later selectors; its narrow scanner declarations describe the pinned dependency. Completion edits, hover and diagnostics use authored positions. `src/editor/grammar.ts` embeds the editor's `source.css` grammar. |
| Source-aware assistance | `styles/sources/host.ts` defines injected URI/file/directory access; `arguments.ts` reads tolerant CSS-token argument ranges; `workspace.ts` keeps one current snapshot per consumer, source dependencies, completion edits and related diagnostics. The public entry is `@memoized-dom/jsx-plus/styles/sources`. |
| VS Code adapter | `packages/editor-vscode/src/css.ts` translates protocol objects and owns current-document caching, targeted source-directory watchers and stale-result guards. `src/css/sources.ts` supplies workspace file access and unsaved overlays. Adapter 0.0.13 includes source/ID completion; CSS remains independent of TypeScript. Reload/desktop acceptance stays separate. |

The compiler knows no Auwla syntax. Its hook accepts optional static CSS from any
source language, creates `<module-path>.css`, and retains ordinary CSS imports
for the existing bundlers. Physical files with those generated names must not be
created. The JavaScript-only single-module API cannot deliver stylesheet assets;
use a project/bundler, or consume `compileModulesDetailed().css` yourself.

## Verification

- CSS-001 through CSS-006 in `spec/styles.cases.json` exercise extraction order,
  quoted/commented closers, host/nested content, authored errors and preservation
  of future CSS properties. `tests/styles.test.ts` consumes those fixtures and
  runs the real example in optimized/general modes.
- The CSS tests also verify host mappings, exclusion from TypeScript checking,
  native CSS completion/hover/diagnostic coordinates with Unicode and CRLF, and
  checking-only assistance before a missing closing tag. A missing CSS brace
  stays diagnosed at the CSS boundary rather than disappearing into the blanked
  host text; completion edits must remain inside authored CSS bodies.
- `tests/styles-vite.test.ts` builds the HTML entry and native relative CSS/URL
  dependencies, verifies CSS-only hot updates, verifies pruning when blocks are
  removed, and checks that a fully static page retains CSS without a script.
- `tests/editor-assets.test.ts` uses the real TextMate engine and pinned native
  CSS grammar, including delimiter-like text inside CSS strings/comments.
- Compiler-next's `core/parse/styles.test.ts` uses an unrelated toy language to
  check the generic asset contract, directives, CSS-only updates and removal.
- VS Code activation tests invoke the providers, check edit/diagnostic positions,
  verify live diagnostic clearing and confirm CSS works without a TS provider.

Review caught an incorrect mount call in the initial example; it now matches the
runtime API and the actual entry is executed. Review also caught a Vite static
page losing its generated stylesheet because the CSS importer was HTML rather
than a compiled module. The adapter now resolves compiler-owned CSS from either.

## Compact class conditions (CSS-2a)

CSS-2a now implements compact class conditions on full property names. See
[the contract](spec/style-conditions.md) and its CLASS-001 through CLASS-012
fixtures. `styles/conditions/values.ts` uses CSS tokens for clause boundaries;
`model.ts` shares rules/ranges between production and checking; `lower.ts` adds
the class to each selector's subject and splits rules to preserve cascade order.
CSS Tree supplies parsing/tokenization/selector generation; native CSS without
the extension remains unchanged. A final `!important` applies to every value in
the declaration, an explicitly provisional profile choice.

The checking view masks clause headers while retaining authored value text and
completion ranges. TextMate injections color the condition headers. Class-name
discovery is deferred; native property-value completion works in each clause.
`examples/class-conditions` has independent loading/error/expanded toggles and a
pseudo-element. Its actual entry mounts with the normal API, and tests apply the
emitted CSS and verify class/painted-value changes in the existing DOM environment
in both modes. Bun and Vite build the same example through existing adapters.

## Compact numeric viewport conditions (CSS-2b)

`conditions/values.ts` uses CSS tokens to distinguish class and numeric clauses;
the shared model retains authored diagnostics/header ranges. `lower.ts` wraps
each numeric clause in a native minimum-width media query, preserving its exact
place in the cascade. `@700` equals `@700px`; `em`/`rem`, decimals and zero are
supported without named-breakpoint configuration. Properties/values stay native.

RESP-001 through RESP-018 specify output and invalid cases. The real multi-file
`examples/responsive` gallery (port 3036) reuses scoped named rules, mixes class
clauses, uses nested heading queries and intentionally reverses thresholds. Its
DOM tests evaluate actual CSS at 299/300/699/700/1000px in both compiler modes,
including root variables, body typography and independent expand buttons.
Happy DOM caches computed styles across viewport changes, so each tested width
gets fresh stylesheet ownership. The test uses its native media evaluator.

Shared tooling masks numeric headers at equal width for native value completion,
hover and precise diagnostics; TextMate colors numeric headers/units. Vite
builds the gallery and updates an edited source-only numeric rule through CSS
without replacing its component. Numeric groups are implemented by CSS-2c below;
named thresholds, range shorthands and header/condition discovery remain later
work. Native media queries cover other query shapes today.

## Grouped numeric conditions (CSS-2c)

`styles/syntax.ts` extends CSS Tree's rule dispatch at numeric group boundaries;
native selectors/declarations still use the library parser. Groups are ordinary
media AST nodes with weakly held authored header metadata. No text expansion
shifts error locations. `conditions/model.ts` validates groups and inherited
declarations; `lower.ts` emits native queries and inherited `&` selectors.
Declarations after groups retain their order through explicit `&` rules where
a CSS bundler would otherwise collect bare declarations before nested rules.

The equal-width checking view replaces group headers with neutral selectors,
preserving braces and property/value edit positions. It suppresses only the
artificial empty-rule warning at those headers, keeping genuine empty-rule
warnings. Shared TextMate rules color numeric groups and delegate their bodies
to the native CSS grammar. Adapter 0.0.12 carries these shared changes.

GROUP-001 through GROUP-016 and `tests/style-groups.test.ts` cover equivalence,
nested thresholds, inherited compact clauses, cascade, literal contexts, invalid
headers/braces/contexts, exact CSS assistance and prefix recovery. Its own
`tests/fixtures/apps/style-groups` app runs in both modes at
299/300/699/700/899/900/1000px, including independent class toggles and scope
isolation. Vite builds and hot-updates the fixture's source-only shared group
without replacing component JS. `examples/style-groups` is a separate gallery,
checked manually through its authoring config and preview; tests never read it.

## Local scope and named reuse (CSS-3a)

Explicit document targets work inside a local block. `:root` variables and
`body` typography reach the document; `body .card` still scopes the card.
Mixed lists/`:is`/`:where` retain scoped local alternatives. Native declaration
inheritance and nested `&` preserve proven document subjects. This corrects the
blanket marker rule that made the user's stress-test theme unreachable. The
new both-mode DOM checks verify visible button backgrounds and scoped isolation;
the old nested-body output assertion now expects a reachable document gate.

`examples/scoping` authors private component styles, file-level sharing and
same-file/transitive `@use("./Cards.auwla", "card-look")`. Named blocks are
definitions; each explicit consumer acquires the rules in its own scope. The
gallery runs actual imported components and independent expand buttons in both
modes. Slot fallback/projected content, SVG SSR/client markers, zero-specificity
cascade behavior, source mappings and authored errors are checked separately.

Scope selectors mark declaration subjects. Explicit native nesting retains the
original ancestor context and wraps only its own declarations, so external
qualifiers keep working. Implicit class and type/pseudo nesting now works through
the shared block reader; declaration-versus-rule dispatch distinguishes braces
inside functions/attributes and custom-property values. Global CSS stays native.

The Vite checks build the gallery and edit a reused definition through native CSS
hot updates. The source-language compiler delivery contract is unchanged. CSS
assistance now reads component/named blocks, masks `@use` for the native CSS
service and reports same-file ID/use errors at authored spans. The real TextMate
engine checks component blocks without capturing returned DOM `<style>` tags.

## Cross-file reuse (CSS-3b)

`styles/Frames.auwla` reuses `styles/Palette.auwla`; both Cards and IndependentCard
consume the shared frame in their private scopes. Palette's SVG and global native
CSS reset import keep their source directories. Compiler-next's generic recipe
hook owns dependency collection, cached source text, aliases and asset updates.
Style-only source JS is not traversed/emitted/executed; the gallery build test
adds an unresolved JS import and throw to prove they never enter the bundle.

Vite watches these source-only files, updates all consuming CSS outputs, and
recovers missing-ID errors through CSS updates without replacing components.
Detailed callers can provide `assetSources`; ordinary projects collect them.
The collector reuses root stylesheet metadata from the existing import pass,
retaining the established two language requests/one normalization per change.

## Source-aware CSS editing (CSS-4)

The shared source workspace accepts an injected `CssSourceHost`, follows only
style uses and reuses `styleChunks` for validation. The validator carries the
originating consumer through expansion, so transitive errors are attached to the
selected use with a related foreign URI/range. Native property/value assistance
continues through the existing equal-width CSS session. Authored syntax errors
retain their ranges, including style-ID headers; only recovered native errors
need CSS boundary clamping.

Path completion lists one relative directory at the cursor; ID completion reads
the selected source, including same-file unsaved definitions. CSS escapes and
quote style survive applied edits. Unterminated argument replacements stop at
the cursor, preserving following host text. Snapshots cache reads for one current
consumer version; missing targets/directories remain dependencies so creation,
deletion and unsaved changes refresh correctly. Closing consumers releases state.

VS Code prefers open text over disk and watches only needed source directories,
including outside workspace folders. Folder selections continue suggestions.
Changing dependencies invalidates linked sessions without requiring a consumer
version change. Ticket/current-session checks discard stale completions and
diagnostics after edits, close or disposal. Physical reads and event lifetimes
remain in the thin SDK adapter; shared code imports no filesystem/editor APIs.

`tests/style-source-tooling.test.ts` owns in-memory source cases. The adapter
has independent multi-file fixtures and probes its built CJS under Node with
real filesystem reads; source JS imports/throws never execute. The existing
scoping gallery is a manual authoring example, not a test dependency.

## Remaining work

Relative cross-file editor ID/path discovery and dependency diagnostics are now
implemented by CSS-4. Alias resolvers are injectable, but VS Code project alias
configuration is not connected. Untitled/opaque URIs without a source directory
defer lookup until saved, retaining native CSS assistance without false errors.
Local-default selectors are defined by [CSS-3a](spec/style-scopes.md), with
[CSS-3b](spec/style-reuse.md) source/nesting extensions. Keyframe/resource renaming
and global/deep escapes remain open; resources currently require globals.
Named conditions remain later design work. Class groups use native `&.classname`
(DX-50); do not add `@.classname { ... }`. Numeric groups are implemented, while
`@md:30px` has no extension meaning.
[Authored CSS shorthands](spec/style-shorthands.md) are documented under DX-52:
restricted values, compound declarations and existing responsive/class conditions.
Definition syntax, sharing/visibility and override rules remain to settle before
implementation. Future element dot-class syntax remains later. There is no Tailwind
dependency, breakpoint JavaScript, style injection runtime or new reactivity.

CSS source maps, route-specific SSR stylesheet discovery, CSS-module-style exports,
CSS auto-imports and CSS formatting are not delivered here. The editor service's
knowledge of new CSS may lag browsers; its warnings do not reject production CSS.
Desktop behavior still needs acceptance after reloading the installed adapter.

Final checkpoint results are recorded in [status](status.md). The gallery's
authored TypeScript check and HTML preview build pass. The
editor artifact runs in Node outside the checkout and checks the actual
class-condition, scoped `Cards.auwla` and responsive named-style files with zero CSS diagnostics and
native value completion. Native completion inside existing hex tokens retains
the CSS service's behavior. The CSS service's ESM entry remains selected for a
complete bundle. Full-root tests were not run; actual desktop/browser acceptance
remains separate from DOM execution and real bundler/mapper tests.
