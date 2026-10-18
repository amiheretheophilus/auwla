# Building a library

Use one `.lib.config.ts` file. No Vite configuration, manual artifact script,
component list, or compiler-specific edits to the project's `package.json`.

```ts
// .lib.config.ts
export default {
  entry: './src/index.ts',
};
```

```sh
memoized-dom package
```

The root entry may export any number of helpers and components. The tool follows
local imports and re-exports, compiles the graph, bundles **compiler-emitted**
JavaScript, emits declarations, generates public exports and a package manifest,
then finalizes compatibility metadata and byte-integrity hashes. Component
bodies and application services do not run during the build.

Normal name/version/dependency information comes from the project's existing
`package.json`. It is read, not modified. Publishing overrides can live in
`package` in this same configuration. No proprietary fields need to be added to
the source manifest.

## Root imports and public subpaths

```ts
export default {
  entry: './src/index.ts',
  subpaths: ['./src/public', './src/components'],
};
```

Every supported source module under each listed directory becomes a public
entry, relative to that directory. Directory `index` files collapse to the
directory name:

| Source | Consumer import |
| --- | --- |
| `src/index.ts` | `my-package` |
| `src/public/forms/index.ts` | `my-package/forms` |
| `src/components/button.tsx` | `my-package/button` |

Fifty named exports from the root still need only one root entry. `subpaths` is
optional and must be an array. Those directories are explicit public boundaries:
put only intended public modules there. Other imported helpers are bundled as
needed but do not receive public import paths. `.d.ts` files do not create
runtime entries.

Conflicting paths across directories, `button.ts` versus `button/index.ts`, and
case-only duplicates fail with both source paths. Nothing silently wins.
Symlinked public directories and sources outside the package are rejected.
Named barrels and acyclic local `export *` barrels are followed automatically.
Ambiguous star exports are not exposed; explicit names take precedence. Cyclic
star barrels, namespace re-exports and opaque external stars need explicit named
re-exports.

## Output and publishing

```text
dist/
  package.json                  # generated public exports and publishing metadata
  index.js
  index.d.ts
  entries/                      # public subpath entries, when requested
  chunks/                       # shared implementation chunks, when needed
  .types/                       # declaration implementation graph
  memoized-dom.package.json      # generated compiler facts, contracts and hashes
```

Publish **the generated directory**, not the project root:

```sh
cd dist
npm publish
```

Or run `bun pm pack` in `dist` to create a tarball. The generated manifest owns
the ESM export layout. It does not inherit old root `exports`, build scripts,
development dependencies or root-relative `files` filters. Normal publishing
metadata/dependencies are retained; workspace shorthand is converted to the
installed dependency's version. README/license files are copied when present.
The normal `private` publishing flag is retained too. `package: { private: false }`
is an explicit override when a private development project is meant to publish.
Extracted CSS is exposed as `my-package/style.css`; private JavaScript chunks
are not added as public exports.
Framework runtime/data/router imports present in the emitted JavaScript receive
peer declarations automatically when missing. Explicit dependency ranges are
retained; the ABI check still determines compiler/runtime compatibility. Other
third-party dependency declarations remain the author's normal publishing metadata.

A private staging directory holds the build until compilation, bundling,
declarations and finalization succeed. A failed build keeps the previous output.
`outDir` is tool-owned generated output: do not store authored files there. It
must stay inside the package, separate from sources, and cannot be the project
root, a symlink, or a reserved tooling folder.
The replacement is not a crash-durable filesystem transaction; an interrupted
process can leave its private staging/backup directory for recovery.

Workspace libraries may keep their ordinary root `exports` pointing to `dist`.
Artifact discovery finds the generated `dist/package.json` beside resolved
JavaScript. No compiler metadata is needed in the source manifest.

## Options in the same file

```ts
import type { LibraryConfig } from '@memoized-dom/vite'; // optional type assistance

export default {
  entry: './src/index.ts',
  subpaths: ['./src/public'],
  outDir: './dist',
  minify: true,
  sourcemap: true,
  declarations: { tsconfig: './tsconfig.build.json' },
  package: { description: 'My component library' },
} satisfies LibraryConfig;
```

| Option | Default / meaning |
| --- | --- |
| `entry` | Required root source entry. |
| `subpaths` | Optional array of public source directories. |
| `outDir` | `dist`. |
| `minify` | `true`. |
| `sourcemap` | `false`; generated maps retain authored source content. |
| `declarations` | `true`; use the existing `tsconfig.json` when available. |
| `declarations: { tsconfig }` | Reuse a particular existing TypeScript configuration. |
| `declarations: false` | Skip declaration generation and generated `types` exports. |
| `package` | Normal publishing metadata overrides, including name/version. |
| `aliases` | Optional source aliases; normal tsconfig paths are also enabled. |

Local aliases are relocated in the published declarations too, including
type-only imports and inherited JSONC tsconfig paths. Consumers do not need to
copy the author's alias configuration. Authored ambient `.d.ts` files are kept
and referenced by the public declaration entries.

`--root path` selects the package root. `--config path` selects another library
configuration, relative to that root. The command does not load a `vite.config`
or start a server. Node runs the tooling, even when invoked through Bun.

TypeScript must be installed in the library's development environment for
declaration emission. It uses the installed declaration-only CLI, including the
native TypeScript 7 CLI; this does not replace `bun check` for application
typechecking. Declaration failures stop publication. Public TS/TSX/JS/JSX entries
are supported; TSRX can use `declarations: false` with separate declarations.
Dynamic imports must have static string paths. The initial output is ESM only,
not separate CommonJS/browser/node implementations. Runtime and other bare
package dependencies remain external.

## Runtime implementers

Most libraries need none of these options. `boundaries`, `runtimeOwnedState` and
low-level `compiler` options describe behavior hidden inside opaque dependencies
and intentionally owned runtime bookkeeping. They belong in this same file,
without manually reading source files or writing artifacts.

Utils now uses `.lib.config.ts`. Its only extra boundary describes the data
runtime's holder-preserving `protectLiveSources` call, and it explicitly owns its
private bookkeeping state. There is no maintained module/export list or artifact
script. Compilation cannot infer an unavailable implementation's behavior.

See [compiler package contracts](./package-compilation.md) for compatibility and
integrity guarantees. Low-level compiler APIs remain available to custom tool
hosts, not required for ordinary publishing.
