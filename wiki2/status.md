# Prototype status

Updated: 2026-11-14. Branch: `prototype/jsx-plus`.

## Current focus: numeric responsiveness and document subjects

[CSS-2b](spec/style-responsive.md), accepted in DX-47, implements compact numeric
viewport thresholds: `@700` equals `@700px`. Both emit inclusive minimum-width
media queries without named-breakpoint configuration. Finite nonnegative numbers
also accept explicit `em`/`rem` (provisional), decimals and zero. Clauses keep
authored order and existing class specificity. No property aliases or CSS runtime.

DX-48 corrects a scoping bug exposed by the user's stress-test page: intentional
`:root`, `html` and `body` subjects stay reachable inside a local block.
Ordinary descendants/list alternatives remain scoped. Mixed `:is`/`:where`
and inherited `&` preserve document targets without unscoping local components.
The user's file is unchanged; its theme variables/body typography now compile
correctly. The shared preview builds once at startup and must be restarted.

`examples/responsive` (port 3036) is a real multi-file gallery with a responsive
grid, implicit nested heading queries, source-only named styles, independent
expand buttons and intentionally descending thresholds. Root variables and body
typography live beside local rules in one ordinary style block. Run
`bun run examples/responsive/preview.ts`, or append `--build`.

Verification: **481 JSX+ tests pass across 33 files**, with **8 filtered out**
because they depend on the original styling example that the user replaced.
Tests and user source are not rewritten to restore that fixture. This includes
both-mode computed CSS at 299/300/699/700/1000px, scope/SSR/slot isolation,
authored diagnostics, TextMate highlighting, native completion and mapper checks.
Vite builds the gallery and hot-updates source-only numeric CSS without replacing
components; static delivery, fan-out and error recovery pass too.

JSX+ type checking (347 files), editor checking (181 files) and all **10 adapter
tests** pass. The built CJS artifact runs under Node outside the workspace and
checks native completion in the real responsive named-style source. The gallery's
authored TypeScript check and HTML preview build pass. The user's actual
stress-test preview builds too. Adapter **0.0.11** is installed; its installed
bundle also passes the responsive native-completion probe under Node. Reload
the window to load it. Full-root tests and actual browser/desktop acceptance
were not run.

Preserve the user's modified `examples/styling/App.auwla` and new
`examples/styling/state.auwla`; neither belongs to this checkpoint.
Previous checkpoint `811cdcd9` delivered CSS-3b cross-file `@use(path, id)`,
relative resource rebasing, source-only watching and implicit nesting through
the existing compiler pipeline; its complete package suite passed 457 tests.
The compiler's generic recipe API is unchanged by this slice. Details and owning
files remain in [styling.md](styling.md).

Next: specify grouped numeric conditions, then implement them with editor and
real authoring checks. Named thresholds are optional later design, not a required
configuration step. Cross-file editor ID/path lookup still needs an injected
source host. Property aliases, event shorthand and local named-resource scoping
remain separate work.

## `.auwla` across modules: JSX+ as a source language (DX-39)

The user rejected another agent's uncommitted `src/project/` in JSX+ (a wrapper over
compiler-next's project, its own source-map composer and its own Bun plugin using
`Bun.write`): it duplicated compiler-next and tied JSX+ to Bun. At their request it
was discarded, with its routing example, test and `wiki2/modules.md`.

Rebuilt the other way round. Compiler-next gains a generic `languages` option
([source languages](../wiki/compiler/core.md#source-languages)); JSX+ gives one
value, `auwla` (`src/language.ts`), and nothing else for builds. A `.auwla` module
keeps its path and goes wherever a `.tsx` module goes: `compileModules`,
`createProject`/applications, the Bun plugin and the Vite plugin (dev, hot updates,
builds). Source maps reach the `.auwla` text; syntax errors are `JsxPlusError`s,
now compiler-next `CompileError`s; compiler errors found after parsing are moved
back to the authored position by compiler-next. `compile()` is a one-module
convenience over compiler-next's. Both previews now build with compiler-next's Bun
plugin through `examples/preview.ts`, replacing the task board's per-file loader.

Evidence: `examples/notes` (three `.auwla` components, an explicit and an
extensionless import through a `.ts` re-export, a `.ts` helper with module state).
`tests/modules.test.ts` collects it through compiler-next's project, bundles it with
compiler-next's Bun plugin and runs it in both modes (add, remove, empty state),
checks bundle source maps name the `.auwla` files and reports a broken module at
its line. `tests/vite.test.ts` builds it with Vite, compiles and maps a `.auwla`
module in dev, hot-updates it on an edit without a reload, and reports a dev syntax
error at line 20. Compiler-next's `languages.test.ts` uses a toy language, so the
compiler stays language-neutral; deliberately disabling error relocation failed
only its relocation test. Totals: compiler-next `src` 795 pass; JSX+ 306 pass
(22 files); Vite `next-plugin.test.ts` 7 pass; editor adapter 7 pass; compiler-next,
JSX+, Vite (build config) and spec `bun check` clean. Both previews build and serve.
Not run: the full root suite and compiler-next case files.

### Routes, lazy chunks, data and effects in `.auwla`

The user asked for these to be tested well, with examples. `examples/team` writes
them all in `.auwla`: nested routes (`/people` chrome over `/` and `/:id`),
`route-to` links with params, a catch-all `/*`, three pages imported only for their
routes, a locally declared `NotFound`, `$fetch` through a `.ts` helper whose argument
follows a search box, `$track` loading/error/`refresh()`, a `$routed` preparation,
an `$effect` setting `document.title` with cleanup, and `$cleanup` on unmount.
No compiler change was needed: compiler-next's route lowering, splitting and
sources run on the TSX the language gives.

`tests/routes.test.ts` bundles it with compiler-next's Bun plugin and chunk
splitting into a temporary folder, then loads it with `import()`, so pages are real
lazily loaded modules. It checks the three pages are only in chunks and the local
page in the entry. In both compiler modes it drives the app with clicks, typing and
`popstate` against an in-memory `fetch`: a failed first request and its Retry, a
search refetch (`?search=al`), a parameter link prepared by `$routed`, the title
effect and its cleanup, `$cleanup` on leaving About, and the catch-all page. A deep
link to `/people/2` shows the person as soon as `import()` returns, with one request
(the entry waits for the chunk and preparation). `tests/vite.test.ts` checks a Vite
build splits the same pages into chunks the entry imports dynamically. Three runs
of the routes file passed; JSX+ suite 311 pass (23 files).

Follow-up at the user's request (they noted `Group` and `<slot>` were unused, and
a browser warning "unreachable code after return statement" in `Person`'s chunk):

- `App.auwla` wraps the pages in `<Group pending=PageLoading>`; `People.auwla` adds
  an error-only `<Group error=Failure>` that inherits that pending policy across
  files, with `retry`; `$track` now only shows "Updating…" during a refresh.
- `components/Card.auwla` has named `header` (with fallback) and `actions` slots and
  a default slot; Home, Person, About and the catch-all fill or omit them.
- The fake API can hold responses, so the test now sees the Group placeholder at the
  list, the error component and its retry, the old list kept while "Updating…"
  shows, and `$routed` keeping the list until the person arrives. It checks no
  `<slot>` element reaches the DOM and the header fallback on the catch-all page.
- The warning was compiler-next's: a shared frame always appended
  `_completeShared(void 0)` after the setup, even when the setup ended in `return`.
  Fixed in `features/state/shared-dom.ts` (reconcile table), with a test that fails
  on the old line; a rebuilt team preview has no statement after a `return`/`throw`
  in any of its 8 files.

Found while writing it:

- A text child directly followed by a tag (`"Could not load. " <button>`) is a
  comparison under grammar rule 5, so a `;` is required. The diagnostic said
  "Closing tag does not match its opening tag". Fixed (spec revision 8): it is now
  JPX1005 over `<button>`, "needs `;` before it", with an inserted `;` as the
  editor repair, so the rest of the file stays checked. A fragment `<>` there gets
  the same message. The comparison is still never rewritten into a tag; valid
  comparisons such as `x < b > y</b>` are unchanged. A joined tag with the
  enclosing element's own name (`<p>"a" <p>"b"</p></p>`) is valid host code up to
  its first `</p>`. Since spec revision 9 it is a candidate: if the file then fails
  and a `;` before it gets past the failure, the error is JPX1005 there, in the
  compiler and the editor alike.
- The router's window listeners stayed after its app unmounted, so a second bundle
  in the same window lost link clicks to the old router. Fixed since (`1e6b6360`,
  reconcile table): the runtime's `whileApplicationMounted` releases them.

### Server side: SSR, server functions and server-backed `$routed` in `.auwla`

`examples/directory` is rendered on the server and written in `.auwla` down to its server
function module (`server/functions/people.auwla`) and server-only module
(`server/people.auwla`, read as `#server/people.auwla`); `server.ts` and `define.ts` stay
TypeScript. As the user expected, compiler-next already did nearly all of it: the application
passes `languages` to both projects, so `.auwla` components render on the server and hydrate.
Two changes were needed (reconcile table):

- The server folder scan, analysis, endpoint names, facades and `#server/` probing only knew
  JS/TS. They now use the language (`moduleText`), with errors at the authored line.
- A genuine compiler-next bug, plain `.tsx` too: once a page reads a server function, the
  server entry's `app.ssr(App)` became a source builder step whose storage was never declared,
  and the built server threw `_sourceStep is not defined` on start. Fixed in
  `core/emit/shared.ts`; its test fails without the fix.

`tests/server.test.ts` builds the server with compiler-next's Bun plugin and asks it for pages
with no browser window (the preload's happy-dom window made the render act as a browser): the
list from `listPeople()` with its transferred data, `/people/2` prepared by the server-backed
`$routed`, the not-found branch, and the `.auwla` endpoint. Then, in both compiler modes, the
client starts on the server's page with `fetch` sent to that server: it adopts the server's nodes
with no request, a link asks `POST /_memoized/routed` for the person, and the form posts
`createPerson` then reads the list again. 3 pass. `examples/directory/preview.ts` serves it
(port 3033) and writes `.memoized/server-functions.d.ts`; with it, `tsc` over the example's
`tsconfig.json` reports no errors, `#server-functions` typed from the `.auwla` module.

Editor finding (the user hit it): TypeScript 7.1 with `contentMappers` loads a `.auwla` module only
when the import names it. `'../people'` builds (compiler-next probes extensions) but is TS2307 in
the editor; the notes example's `./NoteList` re-export has the same error. Probed further: the
mapper protocol only transforms text, so resolution is TypeScript's. An alias works with a
`paths` fallback (`"#server/*": ["./server/*", "./server/*.auwla"]`), which the example now
uses for `#server/people`; a relative import cannot, since `paths` never applies to one. The
example writes `.auwla` in its relative import ([tooling](tooling.md) already says imports
use the explicit extension).

Vite full-stack, checked after the user asked: `tests/vite.test.ts` builds a copy of the
directory with `createBuilder` (`serverEntry`, `server`, `languages`) and asks the built
`dist/server.js` for the home page, its hydrating client asset, `/people/2` prepared on the
server and the `.auwla` endpoint; the `.memoized/server-functions.d.ts` it writes names
`people.auwla`. Vite's SSR dev server (`createDevServer`) renders the same pages and shows an
edit to `Person.auwla` on the next request. No change was needed. The example gained an
`index.html` with the SSR outlet for Vite.

### Backend code is plain (DX-30)

The user asked whether pointing compiler-next at the backend folder already gives DX-30's
non-reactive backend. It gave isolation (server-only, never in the client) but compiled that
code reactively, `.ts` and `.auwla` alike: the directory's 20-line store became 3,338
characters of versions, readers, source guards and callback boundaries. Fixed in compiler-next
(reconcile table): the application declares its server-only code (the server folder, the server
entry, the generated registry and `serve()` wrapper) through a new `serverOnly` option, and that
code gets no readers, no observed edits, no source readiness (unless it uses the data
intrinsics or holds markup) and no write flushing around `await`. The store and server
functions now compile to their authored JavaScript; the registry went from 9,377 to 2,073
characters ([server](../wiki/compiler/server.md#backend-code)). Pages rendered on the server keep
their machinery. The JSX+ server (both modes), Vite and routes tests run the result.

Cross-file editor checks (TOOL-07, [tooling](tooling.md)): rename at a declaration and
auto-import completion across `.auwla` and `.ts` modules already worked through the content
mapper, and are now tested against the real language server. One gap was fixed: completing a
component's tag while it was still being typed (`<Badg` before `</section>`) found nothing,
because the closer's `>` ended the opening tag and the enclosing element was set aside. The
opening tag now ends before `</`, and recovery closes it for checking (spec revision 9).

Reactivity inlay hints (TOOL-08, [tooling](tooling.md)), asked for by the user (2026-11-14):
the VS Code adapter shows `state`, `derived ← inputs` or `source` beside each declaration,
from compiler-next's analysis. The user's rule: a value that re-runs when its inputs change is
derived, even when it loads data (`getPeople(search)` is `derived ← search`).

For the compiler-next owner, found while building them: analysis reports
`let query = ''`, declared after `let tasks = [...]`, as `Derived` from `tasks` (the task board
shows it). At runtime writing `tasks` leaves `query` alone, so behavior is right, but the
compiled component carries takeover bookkeeping for `query` (`_queryTaken`, `_fromTaken`) that
plain state should not need. The hints ignore that dependency (they use what an initializer
reads). Not changed here.

Not yet: streaming/live server functions in `.auwla`.

Ordinary backend packages, checked next: Express is not installed in the workspace (adding it
would change dependencies), so `server/status.auwla` uses Hono, already a root dependency, and
`node:crypto`; `server.ts` mounts it at `GET /api/status`. `tests/server.test.ts` gets its JSON
from the built server and checks its compiled output is the authored code with no runtime
machinery; the Vite tests build and serve the same copy. The example's tsconfig adds `node` to
`types` so `tsc` accepts `node:crypto`; it reports no errors.

A project build asks for each `.auwla` module's TSX twice per change: once for its imports
(`project/collect.ts`) and once to compile it. The team build normalized every file twice.
`src/language.ts` now keeps the last result (or syntax error) per path with its text, so the
second ask reuses it and an edit is normalized once. Compiler-next is unchanged.
`tests/modules.test.ts` checks it and fails without the cache.

### Open, to discuss: module state during server rendering

Not decided, not changed. The user leans toward module state being shared across requests
during SSR (2026-11-14) and wants to talk it through first. The leak and the trade-offs are on
[server](../wiki/compiler/server.md#request-isolation-open), under "Shared or per request". Until
that is settled, `request-state.test.ts` stays an expected failure that assumes per-request state;
if the answer is "shared", that test changes with the decision.

### Bundle size (measured 2026-11-14)

The user found the team example's 165 kB (57 kB gzipped) far too large. Measured with the
preview's settings (Bun, minified, split chunks), sizes attributed to source files through the
linked source maps:

| Build | Minified | Gzipped |
| --- | --- | --- |
| Counter (`.tsx`, state and a click) | 22,047 | 8,392 |
| One `$fetch` (`.tsx`) | 60,380 | 20,083 |
| Two routes (`.tsx`) | 71,666 | 24,380 |
| Team example as `.auwla` | 165,174 | 56,652 |
| Team example as the TSX jsx-plus emits, compiled as plain `.tsx` | 165,088 | 56,655 |

- `.auwla` costs nothing: the same app as plain TSX is the same size (the 86 bytes are chunk
  names). The weight is in the packages the app reaches.
- Team by package: runtime 57 kB, data 42 kB, router 41 kB, the app's own code 22 kB.
- The largest single files are `router/src/runtime.ts` (17 kB) and `data/src/resource.ts`
  (12.5 kB). Neither is split, so any route or any fetch brings all of it.
- Code an app ships without using:
  - hydration adoption (`runtime/src/adoption.ts` and the hydration markers) in client-only apps;
  - the live-source protocol and its diagnostics (4 kB) with one plain `$fetch`;
  - scroll restoration (4 kB) with any route;
  - restoration (5.8 kB) once `$routed` is used. `data/src/index.ts` also installs restoration
    when it loads.
- For scale: `bench/package-size` budgeted the old compiler's todo app at 30,000 B raw and
  11,000 B gzipped.

No reduction has been made: runtime, data and router are shared with `compiler-rewrite`, so
cutting them belongs to that track, or needs the user's go-ahead here.

## Current editor fix and next integration slice

Unfinished host expressions in template conditions now stay mapped for native
TypeScript completion: `if (name.) {}`, optional members, `else if`, loop
iterables and rows, attributes, ternaries and quoted interpolation. Empty
conditions/iterables have exact cursor anchors. Recovery is checking-only;
production still rejects incomplete programs. The user reloaded VS Code and
confirmed completion works (2026-11-13). See [recovery](recovery.md).

JSX+ `bun check` is clean across 258 files. The complete package suite passes
**297 tests, 0 failures**, across twenty files. This includes actual applied
completion edits, empty-slot scope checks, hover/rename while a condition is
unfinished, LF/CRLF mappings and both-mode execution of the new greeting example.
No compiler-next/runtime files changed for this fix. The live checking
`App.auwla` draft remains excluded from commits.

The user's next priority was imports and routing across `.auwla` modules using the
latest compiler project/application APIs, before CSS or event conveniences.
Imports are built (section above); routing in `.auwla` is the next proof.

## Compiler baseline synchronization

This branch integrates `compiler-rewrite` through `07e996c9` (2026-11-13).
The local and remote compiler tips matched when fetched. The user authorized
committing and pushing the synchronization while excluding their live
`App.auwla` edits. `compiler-rewrite` itself is unchanged.

Two merge conflicts were resolved in `analysis/frontend.ts` and `pipeline.ts`
using the latest compiler implementation. The compiler, runtime, data, router,
server and Vite directories match that compiler tip exactly. This retains route
lowering/splitting, source maps, component hot replacement, project/application
builds, server functions and the compiler-next Vite adapter. The existing JSX+
syntax and checking package remain separate; the CSS proposal is still a design.

The previously listed compiler/runtime changes from this branch were already
adopted on `compiler-rewrite` in `bd237a29`. The reconciliation table below is now
a historical record, not outstanding adoption work. Further interop changes must
still be recorded there under DX-34.

The branch switch exposed LF-only fixture searches against CRLF example files.
Three JSX+ test files now match the authored line endings when removing imports
or damaging multiline markup. Auto-import assertions still check TypeScript's
exact generated LF edit and preserve every other authored line ending. No
production parser or compiler behavior changed for this correction.

Integration checks: compiler-next `bun check` is clean (269 files); JSX+
`bun check` is clean (255 files); the editor adapter check is clean (6 files)
and its 7 activation tests pass. The 83 focused compiler tests for analysis,
source maps, routes, lazy route splits and hot replacement pass. The 46-fixture
spec baseline also passes; extended execution is covered separately by the
package tests, not claimed by that baseline runner.

The initial JSX+ run passed 263 tests and exposed the five LF-only fixture
failures. All 23 tests in the three corrected files then passed across focused
runs. The final full run passed 266 tests with two failures: during verification,
the live `examples/checking/App.auwla` acquired an unfinished `if(name.)` edit.
Those two tests expect a clean baseline example. That user draft is preserved
and unstaged; the run is not reported as fully green. The root suite, browser
acceptance and performance checks were not run. The staged whitespace check
also reports an existing extra EOF blank line in the incoming
`features/slots/lower.ts`; the compiler tree is retained exactly as received.

## Current requested sequence

The user requested three steps in order: (1) incomplete-code recovery,
(2) bare-handler completion and auto-imports, (3) direct `for...of` inside markup.
Step 1 and its structural follow-up are built ([recovery](recovery.md)). Step 2 is done. The
task board imports `focusTaskInput` from `examples/task-board/actions.ts` and uses
it as `onClick=focusTaskInput`, and execution checks click it in both modes.
Typing `onClick=focusTask` without the import and accepting TypeScript's
completion adds the import and reproduces the authored file
(`tests/handler-import-lsp.test.ts`). That needed end anchors in
`checking/spans.ts`; see [tooling](tooling.md). Step 3 is done (spec r5,
DX-35): `for (const task of tasks) { <li key={task.id}>...</li> }` in markup
lowers to `Array.from(tasks, (task) => row)`; see
[direct loops](syntax.md#direct-loops). All three requested steps are complete.

P4-FOR-FAST is done (`9620fb57`, under DX-34). Compiler-next now gives
`Array.from(items, row)` the compiled rows that `items.map(row)` gets. The
closed-list unchanged-row skip now goes through the same path too: the proof,
planner and emitter ask `mappingCall` for the list a row list iterates instead
of special-casing `.map`. A loop over a plain state list skips unchanged rows
exactly as `.map` does. The task board's lists are derived (`visible`) or
module data (`filters`), so neither spelling skips there. One-line DOM event
handlers that return the list (`onClick=(() => rows.reverse())`) no longer turn
the skip off; component props still do.

The task board `App.auwla` is the one real example. It uses direct loops in its
template instead of `.map()`: the status buttons loop over a `filters` array,
and the task rows loop over `visible` inside the `else` branch. Both compile to
compiled row lists (`_rowList.from(...)` in the served preview bundle). Its
execution test checks the loops in both modes. The LSP completion, auto-import,
recovery and loop-binding rename tests edit it. The separate `ForLoop.auwla`
variant and the preview's `--for-loop` flag were removed at the user's request;
the task board covers everything they did.

## This session: review and cleanup

The user asked for the previous agent's work to be reviewed for correctness,
duplication and readability before new features. Done, in separate commits:

- Fixed: the task-board editor tests opened the task board under
  `examples/checking`'s file URI and project (`taskBoardRoot` now).
- Shared helpers: `masks.ts` (every parser-only mask), token helpers in
  `host.ts`, `authoredCover`/`nearestAuthoredOffset` in `source.ts`. Attribute
  readers return an `AttributeValue` that carries its own mask.
- `normalize.ts` split into `markup/context.ts`, `markup/element.ts` and
  `markup/children.ts`. An unreachable uncached-block fallback now reports
  an `INTERNAL` diagnostic instead of misreading children.
- Fixes: compiler errors on generated text no longer leak normalized-TSX
  positions; editor messages drop the duplicated `(file:line:col)`; the mapper
  `initialize` handler no longer crashes on missing encodings; flow insertion
  order is an explicit, tested rule.
- Tests: one `tests/lsp.ts` session helper replaces repeated LSP plumbing.
- Spec revision 4 (diagnostics only): JPX1009 for undelimited non-identifier
  attribute values; JPX1005 for a top-level child comma. See the
  [changelog](spec/CHANGELOG.md).

Continued from the uncommitted recovery work after that review:

- Checking-only repair suggestions preserve unfinished strings, attribute
  parentheses/braces and direct-loop headers; selected missing/partial tags
  recover too. Inserted text stays unmapped and never reaches production builds.
- Review fixes: closing-tag scanning retains Unicode combining marks and astral
  letters; breadth-first search tries fewer repairs first; recovery does not drop
  an outermost unclosed opener and reinterpret its children as host statements.
- Real-server completion works inside the unfinished attribute itself, as well as
  around structural damage. Multiple repairs retain authored UTF-16/CRLF offsets.
- Spec revision 6 documents diagnostic locations for these already invalid
  inputs. No accepted syntax or event evaluation changes.

The first decoupled editor adapter is now built (DX-36):

- `packages/editor-vscode` handles activation and language/grammar registration.
  It depends on shared `./editor` metadata/mapper contribution and `./editor/grammar`
  assets in `jsx-plus`; the shared code has no editor SDK dependency.
- Its build emits a standalone TextMate grammar, language configuration and
  upstream license. Real tokenizer tests use the task board; the shared mapper
  contribution launches and transforms that same source without VS Code.
- At the user's request, TypeScript 7 (`TypeScriptTeam.native-preview` 1.0.2)
  and the local Auwla VSIX 0.0.2 are installed and listed by VS Code. Installed
  activation now resolves the mapper through open project folders, not the
  extension's installation directory. The VSIX keeps the mapper in the project.
  After the quoted-interpolation update, the user opened the task board
  `App.auwla` in desktop VS Code with the installed extension and reported that
  it works, with autocompletion including the quoted `{remaining}` (2026-11-11). Inferred-project type setup, another editor and a
  standalone mapper distribution remain unverified. See
  [adapter setup](../packages/editor-vscode/README.md).

Live editor follow-up: the provider initially ran bundled TypeScript 7.0.2, which
rejected mapper contribution registration. The user selected the workspace
7.1.0-beta SDK; the running process now uses that executable. Adapter 0.0.1 reports
the selected SDK and offers the native version picker for unsupported servers.
The counter project enables existing element types once through `./types`, with
`jsx: "preserve"`, so it needs no per-file type import. The real server test now
checks its clean baseline, authored error and hover after editor registration.

DX-37 is built in spec revision 7: `<p>"Count: {count}"</p>` becomes a native
template, with host-token substitution boundaries and exact authored mappings.
The counter uses it. Native LSP tests complete, hover and rename inside the quotes,
including completion in empty or unfinished expressions. Shared highlighting marks
the expression as code. Auwla 0.0.2 packages those assets and is installed; reload
VS Code to replace the old grammar and mapper process. See [syntax](syntax.md).

## Evidence

At this interpolation checkpoint: JSX+ `bun check` reports no errors across 228 files.
JSX+ `bun test` passes **266 tests, 0 failures**, in eighteen files. They include
the 34 checking-flow targets, real TypeScript 7 CLI/LSP renames, completions,
auto-imports and recovery. The three anchor/auto-import tests fail without
`checking/spans.ts`. The spec baseline passes 46 fixtures
(10 parse, 15 diagnostics); the JSX equivalents run in both compiler modes.
`bun check -p wiki2/spec/tsconfig.json` is clean. Task-board execution in both
compiler modes and real TS7 CLI/LSP checks pass in the package suite.
The adapter's `bun check` (6 files), `bun run build`, `node --check
dist/extension.cjs` and seven simulated activation tests pass, including project
resolution from outside the checkout. VSCE packaging and CLI installation succeed.
The counter project's TS7 CLI check also passes without a per-file type import.
The slice's staged whitespace check passes. No sub-agents were used.

For P4-FOR-FAST: compiler-next `bun check` is clean. All 191 `src/optimize`
tests pass, including the 7 new `mapping-calls.dom.test.ts` tests. The 398
case/unit tests in the seven files that use `Array.from` pass, and so do the
runtime's 61 list-map/row-list tests. Deliberately breaking the runtime's hole
handling, iterator check or cache density made the new tests fail. Not run: the
full root suite, performance, browser layout and IDE activation.

## Continue

1. Cross-file editor checks: rename/completion across `.auwla` imports. Extensionless relative
   imports are TypeScript's resolution (TS2307; aliases work through `paths`, see the server
   section above); choosing between the explicit-extension rule, a checking-view rewrite and an
   upstream request is the user's decision. The server side
   (SSR, `.auwla` server functions, server-backed `$routed`) is done. Keep every build concern in
   compiler-next.
2. P3-EDITOR (first adapter/assets built, DX-36): verify the 0.0.2 desktop update with
   the compatible TypeScript provider and the real task board, then inferred
   projects and portability beyond the local VSIX. Reuse by other extensions is documented;
   a second editor still needs its own integration evidence.
   See [tooling](tooling.md#editor-extension-planned-p3-editor).
Done since: loops and `.map` share one closed-list path (see the reconcile
table). Compiler-next `src/optimize` and `src/features/handlers` tests and the
six case files using `Array.from` pass (644), with every closed-list case run in
both spellings; forcing the loop skip to ignore edits failed only the eight loop
variants that edit items. After the event-handler return change: the same
optimize/handlers/list case files (742) and the handler and component case files
(84) pass. Edits through destructured names (`entries()` loops) are shown
(`4072c829`). Compiler-next `src` unit tests (616) and the seven
handler/list case files (235) pass. The slow reference/generator suites
were not run locally. Damaged markup beside an ordinary host syntax error no
longer hides the file's diagnostics ([recovery](recovery.md)); a real-server
case shows both errors with completion still available.

Known open issues:
- Recovery remains heuristic and bounded to three repairs and 24 rereads.
  Completion inside quarantined text and broader combinations of multiline
  damage remain open. Same-line host declarations now survive when an inserted
  closer repairs the markup; unsafe host-code removal still falls back.
- Replay proofs remain open. `.auwla` builds go through compiler-next's project, Bun
  plugin and Vite plugin with maps to the authored text (DX-39, above), and its server
  build renders, prepares `$routed` and answers server functions (directory example).

## Compiler-next changes to reconcile

Compiler-next is unfinished (branch `compiler-rewrite`) and is continued
separately. Under DX-34 this branch may change it for `.auwla` interop. Rows up to
`232c8f5b` were adopted (`bd237a29`, then the merge `c56e2b35` of 2026-11-13).
The later rows through `0855afa3`, including the CSS-1 checkpoint, are also
adopted: `compiler-rewrite` fast-forwarded through `6bbb6aa0`, recorded by
`83af94ab`. Verified all nine previously listed pending commits are ancestors
of `compiler-rewrite` on 2026-11-14. The new CSS-3a analysis API below still
awaits adoption. Retain the record and track new changes here:

| Commit | Change | Why `.auwla` needs it |
| --- | --- | --- |
| CSS-3b checkpoint (pending adoption) | `SourceStylesheetRecipe`/`SourceAssetResolver` and `assetSources` extend the generic language contract. `core/assets/stylesheets.ts` resolves recipe inputs; `project/style-sources.ts` collects/caches source-only dependencies using the existing resolver/host. `collect.ts` retains metadata from its existing import pass; `project.ts` watches/prunes source-only inputs and compares CSS. Vite adds source watch files and recovers style-only failures through CSS. Tests: generic toy-language asset sources plus the real JSX+ transitive gallery ([core](../wiki/compiler/core.md#source-languages), [project](../wiki/compiler/project.md#source-only-stylesheets)) | Cross-file named rules need compiler-owned source resolution/delivery, without JS imports, duplicate normalization or a second JSX+ project |
| CSS-3a checkpoint (pending adoption) | `analysis/markup.ts`, its tests and public export: `inspectMarkup(normalizedTsx)` returns native attribute insertion positions, enclosing function ranges/indices and production component flags, mapped through type/slot lowering. No reactive graph, DOM emission or runtime changes ([analysis](../wiki/compiler/analysis.md)) | Local CSS must stop at real component boundaries without reimplementing component classification in JSX+ |
| CSS-1 checkpoint | `core/parse/languages.ts` accepts optional static stylesheet text and creates a companion import; parse/resolve retain the asset; detailed results/project updates expose `css`; existing Bun/Vite adapters resolve/load it, including static HTML links | Native style extraction needs compiler-owned CSS delivery; JSX+ supplies text only. Adopt/review this generic extension on compiler-rewrite under DX-34 |
| `1d3ef3bf` | New read-only analysis API in `packages/compiler-next/src/analysis/`; `pipeline.ts` shares its frontend; `./analysis` package export ([compiler analysis](../wiki/compiler/analysis.md)) | The checking flow planner reads binding/dependency facts without DOM emission |
| `dbe46803` | `analysis/index.ts` re-exports `CompileError` | The planner skips modules the compiler rejects |
| `a35db526` | `analysis/serialize.ts` also describes JSX spread arguments (`{...props}`) as expressions | Spread inputs get flow checking like expression containers |
| `b05773b5` | `runtime/src/setters.ts`: uncached ARIA `false`/`true` follow the cached/spread rules, with a DOM test | Found by the task-board example; a runtime bug fix, not interop |
| `9620fb57` | New `optimize/mapping-calls.ts` ([optimize](../wiki/compiler/optimize.md#row-lists)). Row reuse and row lists accept the intrinsic `Array.from(items, row)`, with `rowReuse.form` added to the plan model. The runtime gains `fromRows`, `RowList.from`, `iteratedItems` and a `dense` cache mode. Closed lists stay `map`-only | Direct loops lower to `Array.from`; without this they never get compiled rows |
| `4072c829` | `features/handlers/plan.ts`: `aliasBindings` judges a destructured name by the declaration or parameter owning its pattern (`patternRoot`), with `features/handlers/aliases.test.ts` ([handlers](../wiki/compiler/handlers.md)) | `for (const [index, task] of tasks.entries())` row edits were not shown; a genuine bug, plain JSX too |
| `03958a19` | `optimize/closed-lists.ts`: the proof finds a row list's root through `mappingCall` (`#rowsOver`), replacing the `.map`-only branch in `#useMethod` and the `form` filter in `match`. `features/handlers/mutations.ts` emits `list.map`/`list.from` and `mapRows`/`fromRows` from one branch, passing `unedited` to both. `optimize/methods.ts` drops `withRowReuse`'s redundant `form` argument. Tests: both spellings in `closed-lists.test.ts` and `conditionals-and-lists.closed.test.ts` ([optimize](../wiki/compiler/optimize.md#closed-lists)) | Loops over plain state lists skip unchanged rows like `.map`, without a second copy of the list logic |
| `232c8f5b` | `optimize/closed-lists.ts`: `returnsToEventDispatch` lets `#useReturn` accept a function literal written as an `on*` attribute of a DOM element that is not `isComponentCall`, since the runtime keeps nothing it returns. Tests in `closed-lists.test.ts` (with controls) and a both-spelling behaviour case ([optimize](../wiki/compiler/optimize.md#closed-lists)) | `onClick=(() => rows.reverse())`, the natural `.auwla` one-liner, turned the skip off; plain JSX benefits too |
| `0cf5a8ae` | New `core/parse/languages.ts` (`SourceLanguage`, `languageOf`, `languageExtensions`, `moduleText`, `authoredError`) with a toy-language `languages.test.ts` ([core](../wiki/compiler/core.md#source-languages)). `languages` option in `options.ts`; `parseModule` reads a language module's TSX and composes its origin; `analysis/frontend.ts` and `pipeline.ts` move post-parse errors back for language modules; `CompileError.reason`; `importCandidates(…, extensions)`; `isSourcePath(path, languages)`, `collect.ts` and `project.ts` collect language modules; `compile()` accepts a language `moduleId`; the Bun plugin loads and probes language extensions; exports `SourceLanguage`, `TextOrigin`, `languageExtensions`. `packages/vite`: `languages` option, forwarded to the application, host, load, resolve and hot-update checks | DX-39: `.auwla` builds through compiler-next's own project, Bun and Vite paths instead of a JSX+ copy of them |
| `0855afa3` | `features/sources/reach.ts`: a route's lazy page loader (`import(…).then((m) => $registerRouteComponent(key, m["Page"]))`, `isRouteModuleLoad`) no longer sets the unknown-code flag; any other `import()` still does. Test in `features/sources/reach.test.ts` with an authored-`import()` control; fails without the change ([sources](../wiki/compiler/sources.md)) | Every browser build with a lazy route wrapped host calls such as `event.preventDefault()` in readiness (directory example); plain JSX too |
| `6c323ef6` | Runtime: `untracked()` (`computation.ts`); effect computations keep keys they write (`createComputation(…, keepsOwnWrites)`, `effect.ts`); the alias index reads roots untracked (`readRoot`, `mutation.ts`). Compiler-next `features/handlers/mutations.ts`: an edit's root binding is read through `untracked(reader)` (`untrackRoot`). Tests in `mutations.test.ts` and the JSX+ routes test, each failing without its change ([handlers](../wiki/compiler/handlers.md#edits-are-not-reads), [effects](../wiki/compiler/effects.md)) | The team example's People effect ran twice per visit (found by the user); effects reading and writing the same state stopped following it; plain JSX too |
| `1e6b6360` | Runtime `whileApplicationMounted` (`mount-core.ts`); router `ensureRouterConnected` disconnects on unmount and reconnects on a later mount (`router/src/internal.ts`). The JSX+ routes test runs both builds in one window ([routes](../wiki/compiler/routes.md)) | A second app in the same window lost link clicks to the old router; found by the routes test |
| `02053794` | `server/request-state.test.ts` records, as `it.failing`, that module state written during a server render carries over to the next request; `server.md` "Request isolation (open)" ([server](../wiki/compiler/server.md)) | Security issue for SSR with real users; the fix is designed next |
| `56fbe0d5` | New `serverOnly` option (`options.ts`) and `Resolved.serverOnly(module)` (`core/resolve/index.ts`); `features/state/reactive-reads.ts` never marks a server-only binding; `core/plan/index.ts` skips `planImportedMutations` there and sets `ModulePlan.serverOnly`; `features/sources/flow-plan.ts` plans no readiness there unless the module uses the data intrinsics or holds markup; `core/emit/dom.ts` adds no `try`/`await` guards to server-only code that renders nothing. `server/application.ts` declares the server folder, entry, registry and `serve()` wrapper. Tests: `server/application.test.ts` (no machinery in server-only output; fails with nothing declared), the readiness-storage test moved to `features/state/shared-dom.test.ts` ([server](../wiki/compiler/server.md#backend-code)) | DX-30: `.auwla` backend code is not reactive; plain `.ts` server code benefits the same |
| `9b5428e0` | `server/application.ts`, `server/functions.ts`, `server/registry.ts`: the application's `languages` reach server code. Language modules in the server folder are found, analyzed as TSX with authored error lines (`analyzeServerFunctions(…, languages)`, `serverServices(…, languages)`), named and given `.ts` facades without the language's extension (`serverFunctionModuleName(…, extensions)`, `facadePath`), and `#server/` probes language extensions; `importsServe` reads TSX. `core/emit/shared.ts`: module-level readiness storage is declared when no module owner exists. Tests in `server/application.test.ts` (a toy language; undeclared-storage check that fails without the fix) ([server](../wiki/compiler/server.md#application)) | `.auwla` server functions, services and `#server/` modules; the storage fix is a genuine bug (any `.tsx` server whose page reads a server function crashed on start) |
| `bd2b1eac` | `features/state/shared-dom.ts`: no trailing `$$complete(void 0)` when the shared setup's last statement is `return` or `throw`; `shared-dom.test.ts` checks compiled output has no unreachable statement ([linking](../wiki/compiler/linking.md)) | Found as a browser warning in the `.auwla` team example's `Person` chunk; a genuine emission bug, plain JSX too |

These histories used different commits for the same code before synchronization,
so commit-range output alone does not show whether a change was adopted. Compare
the compiler/runtime trees as well as the history; at this integration they are
identical to `07e996c9`.

See [plan](plan.md), [tooling](tooling.md) and [rewrite acceptance](../wiki/status.md).
