# Project

**Folders:** `project/`

Status (2026-11-12): building from entries, rebuilding after edits, source maps, path aliases through the
host, the file-system host, a Bun plugin and a command line are built. `packages/vite` moves onto it
next (`plan.md`, Phase 10).

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

## Still to do

- `packages/vite` on it, with HMR (`plan.md`, Phase 10).
- Applications with a server build on projects (`server.md`).
- Hot replacement for Bun's dev server, once HMR exists for Vite: `update()` already names the
  outputs that changed.
- The command line serves no pages (no dev server, no SSR); Vite does that.
