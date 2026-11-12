# Project

**Folders:** `project/`

Status (2026-11-12): building from entries, rebuilding after edits, path aliases through the
host and the file-system host are built. Source maps, a command line and a Bun plugin come next,
then `packages/vite` moves onto it (`plan.md`, Phase 10).

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

## Files

| File | What it owns |
| --- | --- |
| `project/project.ts` | `createProject`: build, update, and what changed |
| `project/collect.ts` | The modules the entries reach, and where each import points |
| `project/host.ts` | `ProjectHost`, `fileSystemHost` and project paths |
| `project/index.ts` | The public API, re-exported from the package root |
| `project/project.test.ts` | Collecting, aliases, errors, edits, new and deleted files, disk |

## Still to do

- Source maps from the printer, carried in the build.
- A command line (`compile src/main.tsx --out dist`) and a Bun plugin, as the first small users.
- `packages/vite` on it, with HMR (`plan.md`, Phase 10).
