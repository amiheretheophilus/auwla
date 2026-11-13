# Native CSS implementation

Updated: 2026-11-13. CSS-1 is implemented and verified; the user has authorized
committing/pushing this checkpoint and continuing. [dxcss.md](../dxcss.md) holds the wider design;
[spec/styles.md](spec/styles.md) defines this first profile.

## Authoring

Use explicit module-level `<style global>` blocks. Write ordinary CSS, including
custom properties, selectors, pseudo-classes, media queries, imports and URLs.
Several blocks form one stylesheet in authored order. No CSS declarations are
evaluated as JavaScript. A module-level unqualified `<style>` is deliberately
unsupported until the local/default scope decision is made. A returned DOM style
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
| JSX+ syntax | `src/styles/blocks.ts` uses host tokens and a module-item probe to distinguish standalone blocks from ordinary host/markup content. Its CSS delimiter scanner respects CSS comments, strings and escapes. `src/normalize.ts` blanks blocks, preserving host mappings, and returns optional `stylesheet` text. `src/language.ts` passes it to the compiler hook. |
| Compiler assets | Compiler-next's `core/parse/languages.ts` appends the side-effect CSS import after authored host code, preserving directives/shebang positions. Parsed/resolved modules retain the companion. `pipeline.ts` exposes `css` separately in detailed results; `project/project.ts` compares JS and CSS in updates. |
| Existing delivery adapters | Compiler-next's `project/bun.ts` resolves and loads the virtual CSS companion with Bun's CSS loader. Vite's existing `next/plugin.ts` loads it before native CSS processing, including from static HTML whose script was removed. No JSX+ project wrapper/plugin is introduced. |
| Shared assistance | `src/styles/tooling.ts` uses `vscode-css-languageservice` over an equal-width CSS projection. `styles/recovery.ts` keeps missing-colon errors on unfinished property names and reparses to avoid errors cascading into later selectors; its narrow scanner declarations describe the pinned dependency. Completion edits, hover and diagnostics use authored positions. `src/editor/grammar.ts` embeds the editor's `source.css` grammar. |
| VS Code adapter | `packages/editor-vscode/src/css.ts` translates protocol objects, caches the current document version and clears sessions/diagnostics on close. It registers independently of TypeScript. Adapter 0.0.5 is built and installed locally; window reload and desktop acceptance remain pending. |

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

## Remaining work

Local/default scope, selector/keyframe isolation and global escapes need their
own contract. Named and grouped conditions on full properties remain next design
work; named breakpoints such as `@md:30px` still have no extension meaning.
Aliases and future element dot-class syntax remain later. There is no Tailwind
dependency, breakpoint JavaScript, style injection runtime or new reactivity.

CSS source maps, route-specific SSR stylesheet discovery, CSS-module-style exports,
CSS auto-imports and CSS formatting are not delivered here. The editor service's
knowledge of new CSS may lag browsers; its warnings do not reject production CSS.
Desktop behavior still needs acceptance after reloading the installed adapter.

The final focused CSS/tokenizer/build checks pass 55 tests; compiler integration
checks pass 30, the existing Vite adapter tests pass 7 and editor adapter tests
pass 9, including a Node test of the built artifact outside the workspace. The
CSS service's UMD entry originally left dependencies unresolved; the build now
selects its supplied ESM entry. The installed 0.0.5 artifact passes that same
Node probe, including a missing-colon property before a valid following rule.
It also validates the actual class-condition example with zero CSS errors and
tests a named-value completion in an unsaved variant of that document. Existing
hex literals keep the native CSS service's completion behavior.
The latest full JSX+ run passed 349 and failed one interpolation check
against the user's concurrently edited counter example. That file was left
untouched. The suite's DOM execution uses the existing test environment; actual
browser resizing/painting and desktop editor acceptance are still separate checks.
