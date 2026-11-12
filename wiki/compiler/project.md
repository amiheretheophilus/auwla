# Project

**Folders:** `project/`

Status (2026-11-12): building from entries, rebuilding after edits, source maps, path aliases through the
host, the file-system host, a Bun plugin, a command line, hot replacement, and a Vite plugin over
applications (`compiler: 'next'`, "Vite") are built. The Vite plugin lacks some of the old one's
features, listed there (`plan.md`, Phase 10).

## What it does

compiler-next reads a whole program at once: sources are followed across modules, and routes
join across components. So something has to collect every module before the compiler runs. The
old Vite plugin did that itself (`packages/vite/src/graph/collector.ts`), so every other tool
would have had to do it again. A project does it once, for any tool:

```ts
import { createProject, fileSystemHost } from '@memoized-dom/compiler-next';

const project = createProject({ entries: ['./src/main.tsx'], host: fileSystemHost(root) });
const build = await project.build();          // { ok, output, initialRender, modules } or { ok: false, error }
const update = await project.update(['./src/Title.tsx']);   // { build, changed, removed }
```

- `entries` are the modules the app starts from. They are also the compiler's `entries` option:
  the only modules whose exports code outside the program uses.
- The **host** turns project paths (`./src/App.tsx`, the keys `compileModules` takes) into text,
  and may resolve imports the default rule does not (path aliases). `fileSystemHost(root)` reads
  a folder under Node or Bun; a bundler plugin gives a host over its own resolver.
- A build follows static imports, re-exports, `import()` of a literal and `import x = require()`
  from the entries. Type-only imports are erased and bring no module. A package, or a file that
  is not source (`./styles.css`), is left in the output for the bundler.
- The project probes the same paths the compiler later picks (`importCandidates`,
  `core/resolve/imports.ts`), and passes what it found as `resolveImport`, before any resolver
  the caller gave.
- A compile error comes back as `{ ok: false, error }` with its module, so a watcher keeps
  running. Any other exception is a compiler bug and is thrown.

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
gives it to the client build only), compiler-next's output works with any dev server that has
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
  the update reach its importers, as a dev server does, until one accepts it. The entry, which
  calls `mount()`, never does, so an edit reaching it reloads the page.
- **Module effects:** a dev server calls `dispose` only on the accepting module, so a module evaluated
  again on the way would start its module-scope effects twice. Before the top-level statement that
  makes its effect scope, the module calls `moduleEvaluating(path)`, which stops the previous
  evaluation's effects. It goes there, not first: a companion output can make the scope of the
  module importing it, and evaluates before it.
- **A failing edit** keeps the last good DOM and rethrows, so the dev server shows its error; the
  next edit that compiles replaces it.
- The added code (`features/hot/emit.ts`) is added to the tree after linking, with no place in the
  authored text, so source maps leave it unmapped.

The old compiler's mechanism (`registerHotComponent` inside every factory) stays in
`runtime/src/hot.ts` until that compiler is deleted.

## Vite

`memoizedDom({ clientEntry, serverEntry?, server?, compiler: 'next' })` (or `MMD_COMPILER=next`) is
the Vite plugin over an application (`packages/vite/src/next/plugin.ts`), until the old compiler is
deleted and it becomes the only one. `server` is the server-only folder, and must be given: no folder
is server-only by its name (the old plugin assumed `server`).

- **Loading:** every module the program compiled is loaded from its output with its source map:
  the client program for the `client` environment, the server's for `ssr`. A relative import from a
  compiled module is probed as the compiler probes it, which finds modules that exist only in the
  build (`./.memoized/…`, companion outputs).
- **Aliases** (`@/label`) are resolved by Vite (`next/host.ts`): a resolved file under the root that
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
- **Delivery and the server:** the server's delivery module is `virtual:memoized-dom/integration`,
  the old plugin's (`fullstack.ts`): Vite's transformed `index.html` in development, the built
  client after a build. The production server entry (`dist/server.js`), `buildApp`, and the native
  dev launcher (`dev.ts`, which re-imports the server after an edit) are shared with the old plugin
  through the same `api`.
- `.memoized/server-functions.d.ts` is written after each build and update that has server
  functions.
- `packages/vite`'s `dist` bundles compiler-next, which ships TypeScript source that Node cannot load
  from a package.

Not yet in the new plugin, each the old plugin's: `compilePackages` (rejected with an error), native
packages, the devtools inspector, the build-time page (`initialDelivery`) written into
`index.html`, extracted styles and route CSS, lazy route chunks, Cloudflare (untested), library
builds and server pages. An edit that moves code without changing output (a comment) leaves that
module's source map stale until its next real change.

**Where they go** (the user's direction, `decisions.md` 2026-11-12): each is built in the project
and application, with its tests here, so the Vite plugin, the Bun plugin and the command line get it
the same way and none drifts. A plugin keeps only what is its tool's:

| Feature | The project's part | The tool's part |
| --- | --- | --- |
| Styles | Extracting each component's CSS; which styles the first page needs and which each lazy route adds | Giving the CSS to its bundler; the `<link>` tags it serves |
| Build-time page | `initialRender` / `initialDelivery` (built), and writing them into the page's HTML | Which HTML file, and when (`transformIndexHtml`, the command line's copy) |
| Lazy route chunks | `import()` for a lazy route, and the route's styles | Nothing: bundlers split at `import()` |
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
  Each `Bun.build` starts a new one (`onStart`).
- A compiled module's code goes to Bun as JavaScript with its source map inline.
- Modules that exist only in the build (companion outputs such as `./App.mmd.tsx`, the generated
  `.memoized/` modules) are resolved by the plugin, probing a relative import as the compiler does,
  since generated imports leave out the extension. A module the program does not reach (a
  package, a stylesheet) is left to Bun.
- `delivery` is the source of the server's delivery module (the page's document and its assets),
  served as `./.memoized/delivery.ts`, so its own imports resolve from the app's folder.
- A compile error fails the build, with its module in Bun's log.

## Command line

`project/cli.ts`, run with Bun:

```
bun packages/compiler-next/src/project/cli.ts check src/main.ts [--server server.ts --server-folder server]
bun packages/compiler-next/src/project/cli.ts build src/main.ts --out dist [--minify] [--root .] [--server … --server-folder …]
```

`check` compiles the application (both programs with a server) and reports the first error
(exit 1). `build` bundles it with `Bun.build` and the plugin, a linked source map beside each file:

- **Client only:** the bundle in `--out`, starting from `index.html` when there is one.
- **With a server:** the client in `<out>/client`, then the server in `<out>/server.js`, whose
  delivery module serves the built page as the document (or a generated page with the
  `<!--ssr-outlet-->` marker when there is no `index.html`) and the client's files through
  `@memoized-dom/adapters/bun`. `bun dist/server.js` runs it, as in `docs/09-ssr.md`.

## Files

| File | What it owns |
| --- | --- |
| `project/project.ts` | `createProject`: build, update, and what changed |
| `project/collect.ts` | The modules the entries reach, and where each import points |
| `project/host.ts` | `ProjectHost`, `fileSystemHost` and project paths |
| `project/index.ts` | The public API, re-exported from the package root |
| `project/project.test.ts` | Collecting, aliases, errors, edits, new and deleted files, disk, maps |
| `project/bun.ts` | The Bun plugin |
| `project/bun.test.ts` | Client: a companion output, a stylesheet, a compile error. Server: a built server rendering its page, a route reading `#server/` code, and a server function |
| `project/cli.ts` | The command line: `check` and `build`, with or without a server |
| `project/cli.test.ts` | Arguments, checking, a client build, and a server build serving its page, its script (which hydrates) and a server function |
| `packages/vite/src/next/plugin.ts` | The Vite plugin over an application: loading, resolving generated modules, hot updates, errors, delivery |
| `packages/vite/src/next/host.ts` | The project host Vite gives: files from disk, aliases resolved by Vite |
| `packages/vite/tests/next-plugin.test.ts` | A client build with an alias; a build from a Windows short name; dev: component, helper and entry edits; a compile error and its fix; dev SSR re-rendering an edit; a full-stack build serving its page, its script and a server function |
| `features/hot/index.ts` | The hot feature's API: `hotModule`, `addHotRuntime` |
| `features/hot/boundary.ts` | Which modules accept their own hot update |
| `features/hot/emit.ts` | The hot runtime's import, `moduleEvaluating` and the boundary in a module's tree |
| `features/hot/hot.test.ts` | Boundaries, module effects, no change without the option, and an edit replacing a component while its parent keeps its state |

## Still to do

- The old plugin's features the new one lacks ("Vite"), then the Vite suite through the switch
  (`plan.md`, Phase 10, acceptance).
- Hot replacement in a real browser (this machine has no Chrome; the tests check what Vite sends),
  and then Bun's dev server: `update()` already names the outputs that changed.
- The command line serves no pages (no dev server, no SSR); Vite does that.
