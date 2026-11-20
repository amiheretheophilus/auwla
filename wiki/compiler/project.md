# Project

**Folders:** `project/`

Status (2026-11-14): building from entries, rebuilding after edits, source maps, path aliases through the
host, the file-system host, native packages ("Native packages"), a Bun plugin, a command line, hot
replacement, and the Vite plugin over applications ("Vite") are built. What is not yet built for
the compiler is listed under "Vite" (`plan.md`, Phase 10).

## What it does

The compiler reads a whole program at once: sources are followed across modules, and routes
join across components. So something has to collect every module before the compiler runs. The
old Vite plugin did that itself (`packages/vite/src/graph/collector.ts`), so every other tool
would have had to do it again. A project does it once, for any tool:

```ts
import { createProject, fileSystemHost } from '@memoized-dom/compiler';

const project = createProject({ entries: ['./src/main.tsx'], host: fileSystemHost(root) });
const build = await project.build();          // { ok, output, initialRender, modules } or { ok: false, error }
const update = await project.update(['./src/Title.tsx']);   // { build, changed, removed }
```

- `entries` are the modules the app starts from. They are also the compiler's `entries` option:
  the only modules whose exports code outside the program uses.
- The **host** turns project paths (`./src/App.tsx`, the keys `compileModules` takes) into text,
  and may resolve imports the default rule does not (path aliases). `fileSystemHost(root)` reads
  a folder under Node or Bun; a bundler plugin gives a host over its own resolver. It settles a
  runtime's own module (`node:fs`, `fs`, `bun:sqlite`, `cloudflare:workers`) as not compiled
  itself, so a bundler's resolver is never asked: Vite's, during the client build, warned until
  2026-11-20 that each server module's `node:fs` was "externalized for browser compatibility".
- A build follows static imports, re-exports, `import()` of a literal and `import x = require()`
  from the entries. Type-only imports are erased and bring no module. A package, or a file that
  is not source (`./styles.css`), is left in the output for the bundler.
- The project probes the same paths the compiler later picks (`importCandidates`,
  `core/resolve/imports.ts`), and passes what it found as `resolveImport`, before any resolver
  the caller gave.
- A compile error comes back as `{ ok: false, error }` with its module, so a watcher keeps
  running. Any other exception is a compiler bug and is thrown.
- `languages` (a compile option) adds authoring syntaxes such as `.auwla`: the project collects
  their files as source and their imports from the TSX they become, and the Bun and Vite
  plugins load them like `.tsx` files ([source languages](core.md#source-languages)).

## Updates

`update(paths)` builds again after files changed, and returns which outputs differ from the last
build that compiled (`changed`) and which modules it no longer reaches (`removed`): what a watcher
rewrites, or what hot replacement sends.

- An edited module is read again; the rest are not (`collectModules` reuses what it knew).
- A path the project has not read may be a new file, which can change where any import points
  (`./Page` now finds `./Page.tsx`), so then every module is read again.
- A deleted module leaves an import pointing at nothing; the build notices and reads every module
  again, so `./page` can fall back to `./page/index.ts`.
- The program is still compiled whole each time. Edits change what other modules may do with a
  value, so a module's output can change when only another module did (an import that now names a
  compiled module is read through it).

## Source-only stylesheets

Source languages may declare source-only stylesheet dependencies through a
`SourceStylesheetRecipe` ([source languages](core.md#source-languages)).
`project/style-sources.ts` follows those specifiers with the existing source
resolver and host, including async aliases and supplied `assetSources`. It
caches their text separately from JS modules and never follows their JS imports
or emits their JS output. `modules` includes both kinds of source for watching;
`output` contains JS modules only. `update()` invalidates either cache and
compares the re-rendered CSS alongside JS, pruning unreachable style sources.
Source-only code is not executed by a style use.

Vite registers source-only dependencies with `addWatchFile` when loading generated
CSS. Its ordinary hot-update path receives project CSS changes for every consumer;
recovery from a style-only source error also refreshes CSS rather than replacing
components. Native CSS processing owns URL resources/imports, as before. Bun
builds consume the same CSS results; no new Bun watcher is introduced here.

## Source maps

With `sourceMaps: true` (a compiler option, so `compileModulesDetailed` and projects take it), each
output has a map back to the text the caller gave, with that text as its `sourcesContent`.

- `yuku-codegen` maps each printed node to its offset in the text the analyzer read. That text is
  the authored text after the compiler's own rewrites: TypeScript lowering, slots, routes, and
  settling `import x = require()`. Each rewrite records where each part of its text came from
  (`TracedText` and `TextOrigin`, `core/parse/text-edits.ts`), the records are composed per module
  (`ParsedModule.origin`, `ResolvedModule.origin`), and `core/emit/source-map.ts` follows every
  position back through them.
- Kept text maps offset for offset. Authored code a rewrite moves keeps its places too: a slot's
  content moved to a prop, a `$routed` callback moved to the module's top.
- Text a rewrite writes (a lowered `enum`, a route table, `import * as x`) maps to where the
  rewrite was. Code the compiler builds after analysis (snippets, `b` builders) has no place;
  the printer reports offset 0 for it, and it becomes an unmapped segment rather than a pointer to
  the first line.
- Module state that moves to a companion output (`./App.mmd.ts`) has its own map, whose source is
  still the authored module.

## Hot replacement

The user asked (2026-11-12) for HMR in the Vite dev server: an edited module replaces its components
in place, keeping the state that can be kept. With `hot: true` (a compiler option; an application
gives it to the client build only), the compiler's output works with any dev server that has
`import.meta.hot` (Vite, and Bun's):

- **The runtime watches instances.** Importing `@memoized-dom/runtime/hot` installs hooks
  (`installComponentHooks`, `runtime/src/components.ts`) at the two places a compiled component is
  called: a value slot mounting it, and `mount()` creating the root. Each instance's id, parent,
  props cell and nodes are remembered. A production page never imports it and pays one null check
  per component mount.
- **Keys match definitions across edits** (`components.md`, "Keys"). A module evaluated again
  defines new functions under the same keys. `acceptComponents()` then mounts each live instance
  of a changed key again with the new function: same id and props cell, nodes swapped in place.
  Outer instances go first, so children their new render mounted are not replaced twice. A module
  that was not evaluated again still holds the old function; mounting it gives the newest.
- **What is kept:** module state in every module not evaluated again (a companion output that did
  not change keeps the state moved into it), and every instance of an unchanged component. The
  replaced instance's own state starts again, as with the old compiler.
- **Boundaries** (`features/hot/boundary.ts`): a module accepts its own update when it defines
  components under keys and exports nothing else (type exports are erased). Any other module lets
  the update reach its importers, as a dev server does, until one accepts it. A separate entry
  (`main.ts`, which calls `mount()` and defines no component) never does, so an edit reaching it
  reloads the page. A component file holding its own top-level `mount(...)` does accept its edits
  ("Mount in a component's file", below).
- **Module effects:** a dev server calls `dispose` only on the accepting module, so a module evaluated
  again on the way would start its module-scope effects twice. Before the top-level statement that
  makes its effect scope, the module calls `moduleEvaluating(path)`, which stops the previous
  evaluation's effects. It goes there, not first: a companion output can make the scope of the
  module importing it, and evaluates before it.
- **A failing edit** keeps the last good DOM and rethrows, so the dev server shows its error; the
  next edit that compiles replaces it. A failure found before either program builds (finding
  server functions) keeps the last build's `modules` (`server/application.ts`, `failed`): the Vite
  plugin counts an edit only when it touches one of them, so an empty list ignored the fix and its
  overlay stayed (2026-11-16).
- **Clearing the overlay** is Vite's client reloading the page on the first update after an error.
  The router let that reload happen only after a fix (2026-11-16): with the Navigation API it
  intercepted every `reload` navigation, so the overlay stayed until a hard refresh.
- **Update time.** Each update compiles the whole program again. For Common Ground (15 modules,
  hot, source maps, warm, this machine) on 2026-11-16 a compile went from 351 ms to 278 ms and an
  `application.update` from about 480 ms to 410 ms:
  - `hasHelperCleanup` (`features/effects/plan.ts`) walked every module once per module; it is now
    answered once per program (planning 53 → 37 ms; it grew with the square of the module count);
  - finished components and modules with `await` are copied by `cloneTree` (`core/emit/copy.ts`),
    which keeps shared nodes shared as `structuredClone` did, faster (emitting 127 → 95 ms);
  - `addHotRuntime` walks a module for a free name only when the module uses the hot runtime.

  Output stayed byte for byte the same, maps included, hot or not, optimized or general. What is
  left is spread thin: emitted trees hold about 40,000 nodes and each full walk of them costs about
  8 ms, done by several passes after linking.
- **In a browser** (`packages/vite/tests/next-hmr-browser.test.ts`, 2026-11-16, in Chrome or
  Edge, `test-support/browser.ts`): an edited component, `.tsx` or `.auwla`, is replaced in place
  while a sibling keeps its count, with no reload and one `<main>`; the edited component's own
  state starts again; an error shows Vite's overlay over the last good page, and the fix clears it
  with an ordinary update, state kept (Vite's client reloads only when the first update after a
  load is a fix); an entry edit reloads. An edit that changes only a comment prints the same
  output, so nothing is sent. Two saves of one file a few milliseconds apart can reach Vite's
  watcher as one, so the test spaces them as a person would.
- **Updates run one at a time** (`server/application.ts`, 2026-11-16). Edits that arrive while an
  update waits join it, so saves made during a build cost one more build together, and a build
  waits for the update before it. The Vite plugin could start two updates together, both reading
  and replacing the same modules.
- **Incremental updates are open.** A module's output depends on facts from its imports and from
  its importers (an importer writing an imported state changes the exporter's code), so reusing a
  module's output safely needs those dependencies tracked first.
- The added code (`features/hot/emit.ts`) is added to the tree after linking, with no place in the
  authored text, so source maps leave it unmapped.

The old compiler's mechanism (`registerHotComponent` inside every factory) stays in
`runtime/src/hot.ts` until that compiler is deleted.

## Mount in a component's file

The user asked (2026-11-14) to stop needing a separate `main.ts`: `mount` may be written in the root
component's own file, which the page loads directly (`<script type="module" src="/src/App.auwla">`,
or `client: './src/App.auwla'` to the application). Built 2026-11-15 (`core/resolve/mounts.ts`, a fact the emitter, `features/hot` and
`features/delivery` all read, so it sits in core):

```ts
// App.auwla (or App.tsx)
export function App() { … }   // exported or not
mount('root', App);
```

A top-level `mount(...)` (an expression statement, or a top-level variable's initializer) is the
module's entry, wherever it is:

- **Server build:** it becomes `void 0`. The server imports `App` from the same file to render it,
  and a server never mounts into a document.
- **Hot replacement:** it becomes `mountOnce(key, () => mount(…))` (`runtime/src/mount.ts`).
  Evaluating the module again after an edit returns the application already on the page, so the
  file accepts its own update (`features/hot/boundary.ts`) and `App` is replaced in place, not
  mounted a second time. Its own state starts again, as any edited component's does. Exporting what
  `mount` returns (`export const app = mount(…)`) is an export that is not a component, so that file
  reloads the page instead; a `mount` inside a function stays as written, and reloads too.
- **Build-time page** (below): the root may be defined in the mounting file, exported or not. The
  run evaluates that module, everything in it, and renders the component its `mount` is given: the
  build's runtime stands in for `mount` and `mountOnce` and never mounts.
- **The application** treats it as any entry: with a server it appends the hydration import, and
  the page hydration import when a server page has bindings.

`packages/jsx-plus/examples/server-pages` is written this way: `App.auwla` ends with
`mount('root', App)`, `index.html` loads it, and there is no `main.ts`. Checked by
`core/resolve/mounts.test.ts` (each build's output, the build-time page, the application, and an
edit to the mounting file replacing its component without a second app) and by driving that
example in a browser.

## Build-time page

A page that cannot change ships as HTML, with no script (`delivery.md`). The compiler decides and
runs the app while building (`initialRender`); `initialPage(shell, shellPath, build)` (`page.ts`)
writes the result into the page's HTML, for every tool: Vite's `transformIndexHtml`, the Bun
plugin's loading of `.html`, and so the command line. Builds only (a dev server keeps the program
for hot updates), and client builds only (with a server, the server renders the page).

- Only an unambiguous shell is rewritten, else it is left to the browser program (null): one module
  script, loading the app's mount module (`src` relative to the page or from the root, no query),
  an empty `<div>` with the mount's id directly in `<body>`, no `<base>`, `<template>` or
  `<noscript>`. The rest of the file is kept byte for byte (the old plugin's rule,
  `packages/vite/src/initial-html.ts`).
- The script took the program's stylesheets with it, so its place gets a `<link>` for each, in the
  order a browser applies them: modules after what they import, each module's imports in the order
  written (`stylesheets.ts`; a build's `stylesheets`). The links are relative to the page, which
  Vite, Bun and the browser read alike; Bun reads `/src/…` from its working directory.
- A plain stylesheet import runs no code, so it no longer sends a page to the browser: the mount
  module may import one, and the build-time run gives it no exports (`features/delivery`). A CSS
  module (`./x.module.css`) still does: its class names are the bundler's.
- Bun gives an HTML page an empty script even when it has none; the command line removes it and
  its tag after building. A `Bun.build` call of one's own keeps that empty request.

### Lazy route stylesheets

`routeStylesheets` (`stylesheets.ts`, `routeStylesheetsOf`) gives, by the key of each route
component that loads with its route (`routeComponents`), the stylesheets its module reaches that the
rest of the program does not: another lazy route component it imports is not entered, and those the
entry already brings are left out. `stylesheets` still lists every one. A browser gets them with the
route's chunk; a page the server renders links them only for the routes it rendered, in development
("Vite") as after a build (`routes.md`, "A lazy route's styles"). Tested in `page.test.ts` and in
Vite's `next-plugin.test.ts`.

Only the first level of `delivery.md` exists in the compiler: a page is wholly HTML or wholly the
browser's. The old compiler's middle levels (a static shell with interactive parts, adopting
pre-rendered nodes) will write their pages through the same function.

## Vite

`memoizedDom({ clientEntry, serverEntry?, server?, runtime?, languages?, runtimePath? })` is the
Vite plugin over an application (`packages/vite/src/plugin.ts`), the only one since the old
compiler's plugin was deleted (2026-11-17, `../decisions.md`). `server` is the server-only folder,
and must be given: no folder is server-only by its name (the old plugin assumed `server`). The
plugin only connects the compiler's results to Vite (`../rules.md`, rule 17).

- **Loading:** every module the program compiled is loaded from its output with its source map:
  the client program for the `client` environment, the server's for `ssr`. A relative import from a
  compiled module is probed as the compiler probes it, which finds modules that exist only in the
  build (`./.memoized/…`, companion outputs).
- **Aliases** (`@/label`) are resolved by Vite (`host.ts`): a resolved file under the root that
  is source is compiled; a package or a virtual module is left to Vite.
- **Paths:** a Windows short name in an id (`C:\Users\THEOPH~1\…`) is spelled out before the id is
  compared with the root, which Vite gives by its real name (`paths.ts`, `longPath`); otherwise an
  entry given that way left the app's modules uncompiled. Needs Vite 8.3.8 or later, the peer range.
- **The dependency scan** reads authored files, so the plugin leaves its resolutions alone
  (`scan: true`). Waiting there for the build deadlocked: the build resolves packages, which waits
  for the scan.
- **Edits:** `hotUpdate` gives the edited file to `application.update()`, once for both
  environments (keyed by the change's timestamp), and invalidates the outputs that changed in each.
  A dev build is compiled with `hot` ("Hot replacement"), so Vite finds the boundaries itself: an
  edited component module accepts itself, a helper's edit is accepted by the component importing
  it, and an edit reaching the entry reloads the page. Only files the program reads, files in the
  server folder, and new or deleted files are compiled again.
- **Errors** go to Vite's overlay with file, line and column; the fix sends an update even when its
  output is the one before the error.
- **Delivery and the server:** the server's delivery module is `virtual:memoized-dom/integration`.
  In development it is the Vite half (`fullstack.ts`): the page from Vite's transformed
  `index.html`, the client's files through Vite. After a build it is the compiler's
  `deliveryModule` (`server.md`, "Delivery and runtimes") with the client's `base`, assets folder,
  route styles and files; the plugin only points each server chunk at the client folder once it
  renders (`relocateClientRoot`). The production server entry (`dist/server.js`) is the compiler's
  `hostEntryModule`; a server built on its own (`vite build --ssr`) gets `standaloneDeliveryModule`.
  `buildApp` and the native dev launcher (`dev.ts`, which re-imports the server after an edit) are
  Vite's, through the plugin's `api`.
- The declaration files (`server-functions.d.ts`, `routes.d.ts`, `server-config.d.ts` in
  `.memoized/`) are written after each build and update from the compiler's `declarationFiles`
  (`server.md`); `memoized-dom types` asks the plugin to build for it.
- **Styles in development:** a page the server renders links the stylesheets every page needs in its
  head, through the document (`dev-assets.ts`), and a lazy route's own (`routeStylesheets`, "Lazy
  route stylesheets" below) only on that route's pages: they go to the server as the dev delivery's
  `routeStyles`, refreshed with each document, which the server links as after a build. Until
  2026-11-17 every route's stylesheets were linked on every page, so in development one route's
  rules applied to another (a regression from the old plugin, which matched routes itself).
  The Vite adapter resolves direct requests for compiler-generated CSS from the compiled asset
  list, even before a JavaScript importer loads. The browser can apply scoped styles on first paint.
- **Source maps** name each source as a file, which Vite makes relative to the module, so the
  browser finds `App.tsx` beside `/src/App.tsx` (the compiler's project paths would have named
  `/src/src/App.tsx`).
- **A missing client entry** is reported for any module asked for, not left to Vite's own JSX
  transform, which would ask for React. The old plugin served what it could reach from the module
  asked for; the compiler builds from the configured entry.
- `packages/vite`'s `dist` imports the compiler's own built `dist` ("Package build"), so the
  `memoized-dom` command line, which always runs Vite under Node, works once the packages are built
  (`bun run build`). Until 2026-11-16 it bundled a private copy, which would have given JSX+
  (loading the compiler's `analysis` entry) a second `CompileError` class. `memoized-dom package`
  is the compiler's `packageLibrary`.
- **Native packages** are found and resolved by the project (`fileSystemHost`, "Native packages"
  below); the plugin only keeps them out of prebundling and SSR externals, allows a linked
  package's folder, watches its files, and writes its type files (`writeLinkedTypes`).

- Cloudflare is a build target of the application (`server.md`, "Delivery and runtimes"):
  `cli.ts build --runtime cloudflare` builds a Worker without Vite; with Vite, `cloudflare()`
  (`packages/vite/src/cloudflare.ts`) wraps `@cloudflare/vite-plugin`.

Not yet built for the compiler: the devtools inspector and the runtime's trace calls in
development (both on hold; FINALIZE). They go in the project or application layer, with the tools
only connecting them. An edit that moves code without changing output (a comment) leaves that
module's source map stale until its next real change.

## Package build

The compiler builds to `dist/` like the other packages (`bun run --cwd packages/compiler
build`, also part of the root `bun run build`; 2026-11-16). Node cannot load its TypeScript sources,
whose imports leave out the extension (`ERR_MODULE_NOT_FOUND` on `./pipeline`). Its `exports` give
each runtime its own file:

- `bun`: `src/`, so Bun (the tests, the previews, the Bun plugin) needs no build and never reads a
  stale one;
- `types`: `src/`, so type checks in the workspace need no build either. Declaration files for a
  published package come with the rename;
- `import` / `default`: `dist/`, for Node.

Only the public entries are built: the root and `./analysis`. The Bun plugin and the command line
(`project/bun.ts`, `project/cli.ts`) are Bun programs, imported from `src/`.

JSX+ (`packages/jsx-plus`) builds the same way, its root and `./language` entries sharing one copy
of the language. The compiler loads `./language` for `.auwla` (`core.md`, "Source languages"),
so on Node one built copy of each package gives JSX+ and the compiler one `CompileError` class.

## Native packages

A native package ships its source and compiles in the app's graph (`linking.md`, "Native
packages"). Finding one is the project's job, so Vite, Bun and the command line compile the same
files. `fileSystemHost` resolves a bare import through `project/packages/native.ts`:

- Node's lookup from the importing file's real folder, so two installed copies at two paths are two
  modules, and a package two packages share through one hoisted copy is one.
- An installed package is native when its `package.json` has `"memoized-dom": { "source": true }`;
  its `exports` map (`default` or `import`) names the source file of each public import.
- A linked package is one outside any `node_modules` with a `.lib.config.ts` saying `source: true`;
  its `entry` and `subpaths` name the public imports, so a stale `dist` is never what compiles.
- An ordinary package is never followed: the project never reads its files.

Package files keep their real paths. An installed one is `./node_modules/kit/src/index.ts`
(pnpm's store included); a linked one outside the root is `../kit/src/index.ts`, which the
compiler's relative imports already spell that way, and which `projectPath` now returns. A tool
decides whether it owns a file by whether the build has output for it, never by `node_modules`.

`.lib.config.ts` is read, never run (`project/packages/library-config.ts`): its default export is a
literal object, optionally through `satisfies`, `as` or a `const`, and anything else is an error
saying so. The old plugin ran a linked package's config through Vite; reading it needs no
TypeScript loader, works the same under every tool, and cannot run a dependency's code.
`nativePackages(root)` lists the native packages before a build, for a bundler's configuration.
An error in a linked package's public entries names the package as the app imports it
(`linked package 'kit': entry './src/missing.ts' must be a source file of the package`), since it
shows in the app's build, far from the package.

Packaging one is the project's too (`packageLibrary`, `project/packages/package.ts`): a native
package ships source, so no bundler is involved. It copies the files the public entries reach,
exactly as written, checks each import (a dependency not listed, a missing file, a file outside
the package, a project-only `#x`), compiles the package once with the compiler so one that cannot
compile is never published, adds the framework packages the compiled output imports as peers, and
generates the `package.json` with `exports` pointing at the source and the marker. Declarations
come from the package's own `tsc` (`project/packages/declarations.ts`). The framework's JSX types
are `src/jsx-types.ts` (`@memoized-dom/compiler/jsx`), TypeScript source: a declaration file in the
staging folder imports them by their `node_modules` path, so `tsc` reads them as a library's
instead of emitting them outside `rootDir`. Until 2026-11-18 it looked for the old compiler's
`dist/jsx-types.d.ts`, which went with it, and `native-package.test.ts` caught it. The result is written to a
staging folder under `.memoized/` and moved into `outDir` once complete. It publishes source only:
a config without `source: true`, or with an option describing compiled output, is refused.
`cli.ts package` runs it, and `memoized-dom package` (`packages/vite/src/cli.ts`) hands every
`source: true` config to it.

**Where they go** (the user's direction, `decisions.md` 2026-11-12): each is built in the project
and application, with its tests here, so the Vite plugin, the Bun plugin and the command line get it
the same way and none drifts. A plugin keeps only what is its tool's:

| Feature | The project's part | The tool's part |
| --- | --- | --- |
| Styles | Imported stylesheets and optional static CSS companions returned by source languages; generated assets/imports and project updates. Syntax extraction belongs to the source language. Scoped TSRX parsing and route-specific SSR CSS discovery remain separate work | Native CSS processing, asset URLs and stylesheet links |
| Build-time page | Built: `initialRender`, and `initialPage` writing it into the page's HTML ("Build-time page") | Built: which HTML file, and when (`transformIndexHtml`, the Bun plugin's HTML loader) |
| Lazy route chunks | Built: a client build loads a component imported only for its routes by `import()` in the route table (`routes.md`, "Lazy route chunks"). Built: `routeComponents` in the build, and the server linking the styles of the routes it rendered (`routes.md`, "A lazy route's styles") | Splitting at `import()`: Vite does by default; the command line turns on Bun's `splitting` (tested in `cli.test.ts`). Which stylesheets a chunk brings (`routeStyles`): Vite from its bundle; Bun's HTML bundling links them in the page already |
| Installed packages | Which ship source, compiling them into the program, their artifacts | Its resolver (the host), cache folder, watching `node_modules` |
| Devtools | The diagnostics compiled code reports | Serving the inspector |

## Bun

`memoizedDom({ client, server?, target?, delivery?, root?, ...options })` (`project/bun.ts`) is a
Bun plugin over an application (`server.md`), for `Bun.build` and for Bun's runtime (`Bun.plugin`):

```ts
await Bun.build({ entrypoints: ['./src/main.ts'], plugins: [memoizedDom({ client: './src/main.ts' })] });
await Bun.build({
  entrypoints: ['./server.ts'], target: 'bun',
  plugins: [memoizedDom({ client: './src/main.ts', server: { entry: './server.ts', folder: './server' }, target: 'server', delivery })],
});
```

- `target` picks the program: the client's or the server's.
- The first module Bun loads builds the application; every other module comes from that build.
  Each `Bun.build` starts a new one (`onStart`), with a fresh application that reads every file
  again. An application keeps the modules it has read and reads one again only when an update
  names it (`createProject`), so before 2026-11-16 a reused plugin built the old sources on every
  `Bun.build` after the first: a watching build never saw an edit (test: `bun.test.ts`, "builds
  after an edit").
- Each `memoizedDom` plugin has an application of its own, and its build compiles both programs.
  `memoizedDomApplication(options)` makes one application for several builds of the same app,
  compiled once: `app.build()` (whose `declarations` a caller can write), `app.plugin('client')`
  and `app.plugin('server')`. Its plugins never compile again by themselves; `app.rebuild()` does.
  `app.rebuild(changed)` is given the files that changed, relative to `root`, and reads only those
  again (the application's `update`); `app.rebuild()` reads every file again. The delivery module is the server program's alone, so one application with it serves both. The
  server pages example's preview compiled the app three times per start before (2026-11-16).
- A compiled module's code goes to Bun as JavaScript with its source map inline.
- Modules that exist only in the build (companion outputs such as `./App.mmd.tsx`, the generated
  `.memoized/` modules) are resolved by the plugin, probing a relative import as the compiler does,
  since generated imports leave out the extension. A module the program does not reach (a
  package, a file-backed stylesheet) is left to Bun. A source language's generated
  CSS companion comes from the program's `css` map and uses Bun's CSS loader;
  its relative imports and URLs stay relative to the owning module's directory.
- `delivery` is the source of the server's delivery module (the page's document and its assets),
  served as `./.memoized/delivery.ts`, so its own imports resolve from the app's folder.
- A compile error fails the build, with its module in Bun's log.

## Command line

Source-language CSS companions are also served by the existing Vite adapter,
before Vite's native CSS processing. Generated CSS can resolve from a compiled
module or directly from static HTML after its script was removed. Project updates
compare CSS assets as well as JavaScript, so a CSS-only edit invalidates its CSS
module; removing the import lets Vite prune it. The JSX+ styling tests exercise
builds, CSS dependencies/URLs, static pages, updates and pruning through these
same adapters. There is no language-specific build wrapper.

`project/cli.ts`, run with Bun:

```
bun packages/compiler/src/project/cli.ts check src/main.ts [--server server.ts --server-folder server]
bun packages/compiler/src/project/cli.ts build src/main.ts --out dist [--minify] [--root .] [--server … --server-folder … [--runtime bun|cloudflare]]
bun packages/compiler/src/project/cli.ts package [--root packages/kit] [--config .lib.config.ts]
```

`package` publishes a native package's source (`project/packages/package.ts`, "Native packages").

`check` compiles the application (both programs with a server) and reports the first error
(exit 1). `build` bundles it with `Bun.build` and the plugin, a linked source map beside each file:

- **Client only:** the bundle in `--out`, starting from `index.html` when there is one.
- **With a server:** the client in `<out>/client`, then the server in `<out>/server.js`, whose
  delivery module serves the built page as the document (or a generated page with the
  `<!--ssr-outlet-->` marker when there is no `index.html`) and the client's files through
  `@memoized-dom/adapters/bun`. `bun dist/server.js` runs it, as in `docs/09-ssr.md`.

## Diagnostics

`diagnoseModules(modules, options)` (`project/diagnose.ts`, 2026-11-17) compiles the modules and
returns the error that stops them: its message without the `memo-dom:` prefix, the module it names
and a one-based line and column, under the code `COMPILER_DIAGNOSTIC_CODE` (98000) and the source
`memoized-dom`. A failure inside the compiler comes back without a place, so an editor still shows
something. The TypeScript language service (`packages/language-service`) shows it in the editor and
only maps the place onto its own positions: the smallest node there, a whole JSX attribute for its
name, a whole element for its opening tag.

## Start-up time

Measured 2026-11-16 on the user's machine, after they found the JSX+ example previews slow to
start. A preview is a fresh process that loads the compiler, compiles the app once and bundles it.
For the team example (about 1.3 s in all):

| Part | Time |
| --- | --- |
| Bun itself | ~150 ms |
| Loading the compiler and JSX+ (several hundred source files, transpiled on each start) | ~160–290 ms; ~4 s once, with a cold disk |
| The first compile in a process | ~300–520 ms (a second compile in the same process: ~120 ms) |
| Bundling, minifying and maps (`Bun.build`) | ~110–160 ms |
| Leaving the process | ~250 ms |

The first compile costs three to four times a later one because its code runs before the
runtime has optimized it. So what the compiler does on each compile still counts, and these went:

- **Emitting copied every snippet twice.** `quote.ts` copied a parsed snippet with
  `structuredClone`, then walked the copy to fill its holes; one pass now copies and fills.
  `copy.ts` built an entries array and an empty map per node; it iterates keys and shares one map.
- **The last two emit passes copied every module whole, needed or not.** `recovery.ts` with no
  `try` hands the tree on as it is; `await.ts` with no `await` makes one plain copy, the same
  output the full pass gave (fresh nodes, none shared, no origins).
- **JSX+ forked CSS Tree's grammar when it loaded** (~50 ms), for apps with no `<style>` too. The
  fork is made on the first stylesheet parsed (`jsx-plus/src/styles/syntax.ts`).
- **The server pages preview compiled its app three times** (`memoizedDomApplication`, "Bun").

Median of seven fresh processes, first compile and later compile: team 414 → 308 ms and
223 → 119 ms; notes 173 → 147 ms and 48 → 36 ms; task board 279 → 207 ms and 94 → 58 ms. Every
example's output, maps included, is byte for byte the same before and after, with and without hot
replacement.

Left: importing CSS Tree builds its default grammar (~45 ms) even with no `<style>`; loading it
only when a file has one needs its ten importers to take it lazily, which the editor extension's
CommonJS bundle must also allow.

Past the compiler, the JSX+ example previews now stay running (2026-11-16,
`jsx-plus/examples/watch.ts`): a saved change calls `app.rebuild(changed)`, bundles again and
reloads the open pages, so the fresh process's cost is paid once per session. Measured on copies
of the examples: notes rebuilds in 66–99 ms; the server pages example, which bundles two programs
and loads the new server, in about 0.7 s. A failed build prints its error and keeps serving the
last good one.

## Files

| File | What it owns |
| --- | --- |
| `project/project.ts` | `createProject`: build, update, and what changed |
| `project/collect.ts` | The modules the entries reach, and where each import points |
| `project/host.ts` | `ProjectHost`, `fileSystemHost` (native packages included) and project paths, `../` outside the root |
| `project/packages/native.ts` | Native packages: resolving a public import to its source file, and `nativePackages` for a bundler's configuration |
| `project/packages/library-config.ts` | `.lib.config.ts`, read as a literal object, never run; a package's public entries |
| `project/packages/linked-types.ts` | Type files for a linked package's public imports |
| `project/packages/package.ts` | `packageLibrary`: publishing a native package's source, its checks and its manifest |
| `project/packages/declarations.ts` | A packaged native package's declarations, written by its own `tsc` |
| `project/packages/package.test.ts` | Packaging then installing into an app the project compiles, the checks that stop it, and `cli.ts package` |
| `project/packages/native.test.ts` | Installed, linked through a junction, an ordinary package, a config inside `node_modules` never read, two copies kept apart, config forms, and a Bun build |
| `project/index.ts` | The public API, re-exported from the package root |
| `project/project.test.ts` | Collecting, aliases, errors, edits, new and deleted files, disk, maps |
| `project/page.ts` | `initialPage`: the build-time page written into the page's HTML |
| `project/diagnose.ts` | `diagnoseModules`: the error that stops a program, with its module and one-based place, for an editor (the language service) to show; a failure inside the compiler is reported without a place |
| `project/diagnose.test.ts` | Nothing for a program that compiles; an error's module, place and message; a syntax error |
| `project/stylesheets.ts` | The stylesheets a program imports, in the order a browser applies them |
| `project/page.test.ts` | Stylesheet order, a static page written with its links, relative `src`, an interactive page and a CSS module left alone, shells it refuses |
| `project/bun.ts` | The Bun plugin |
| `project/bun.test.ts` | Client: a companion output, a stylesheet, a compile error. Server: a built server rendering its page, a route reading `#server/` code, and a server function |
| `project/cli.ts` | The command line: `check` and `build`, with or without a server, and `package` |
| `project/cli.test.ts` | Arguments, checking, a client build, a server build serving its page, its script (which hydrates) and a server function, and the same as a Cloudflare Worker run in workerd |
| `packages/vite/src/plugin.ts` | The Vite plugin over an application: loading, resolving generated modules, hot updates, errors, delivery, declarations |
| `packages/vite/src/host.ts` | The project host Vite gives: files from disk, native packages by the project's rule, aliases resolved by Vite |
| `packages/vite/src/fullstack.ts` | The Vite half of delivery: the dev page and files from Vite's server, and pointing server chunks at the client folder |
| `packages/vite/tests/next-plugin.test.ts` | A client build with an alias; a build from a Windows short name; dev: component, helper and entry edits; a compile error and its fix; dev SSR re-rendering an edit; a full-stack build serving its page, its script and a server function |
| `features/hot/index.ts` | The hot feature's API: `hotModule`, `addHotRuntime` |
| `features/hot/boundary.ts` | Which modules accept their own hot update |
| `features/hot/emit.ts` | The hot runtime's import, `moduleEvaluating` and the boundary in a module's tree |
| `features/hot/hot.test.ts` | Boundaries, module effects, no change without the option, and an edit replacing a component while its parent keeps its state |
| `core/resolve/mounts.ts` | A module's top-level `mount(...)`: left out of a server build, run once under hot replacement, the root of a build-time page |
| `core/resolve/mounts.test.ts` | Each build's output, the build-time page from the mounting file, the application, and an edit to the mounting file |

## Still to do

- The old plugin's features the new one lacks ("Vite"), then the Vite suite through the switch
  (`plan.md`, Phase 10, acceptance).
- Hot replacement in a real browser (this machine has no Chrome; the tests check what Vite sends),
  and then Bun's dev server: `update()` already names the outputs that changed.
- The command line serves no pages (no dev server, no SSR); Vite does that.
