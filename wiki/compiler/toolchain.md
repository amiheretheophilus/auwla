# Toolchain

**Folders:** `core/parse/`, `core/resolve/`, `core/emit/` _(planned)_.

## What it does

Every step that is not specific to the framework uses one toolchain,
[yuku](https://yuku.fyi). The old compiler uses only `yuku-parser` 0.9.3 and
`esrap`, and builds the rest by hand.

| Package (0.19.0) | Gives | Replaces in `packages/compiler` |
| --- | --- | --- |
| `yuku-parser` | ESTree / TS-ESTree AST, comments, diagnostics | the same, upgraded from 0.9.3 |
| `yuku-ast` | typed walker with alias groups (`Function`, `Expression`, `JSX`…), `b.*` builders, `is.*` guards, `collectImports`/`collectExports`, `bindingIdentifiers`, `unwrap` | `ast/walk.ts`, `ast/builders.ts`, `ast/factory.ts`, `ast/types.ts`, `ast/compiler-types.ts`, `ast/access.ts` (about 2,300 lines) |
| `yuku-analyzer` | scopes; bindings with flags; references with `isWrite`; `capturesOf(fn)` (outer bindings a function uses, and whether it writes them); `definition()` followed across files; `resolveExport`; module resolution | `ast/scope.ts`, the scope helpers in `context/ast.ts`, `linking/resolution.ts`, most of `linking/discovery.ts` and `analysis/module-scan.ts` (about 2,400 lines) |
| `yuku-codegen` | printing, type stripping (`strip`), source maps, attached comments | `esrap`, `ast/printer.ts`, `ast/strip-typescript.ts` |

Not used: `yuku-minify`. Vite and rolldown already minify the bundle.

Other libraries:

| Library | Use |
| --- | --- |
| `happy-dom` | the DOM in tests (already used by `test-support/`) |
| `fast-check` | generates test programs and shrinks failures (`testing.md`), so we don't write our own shrinker |
| `@memoized-dom/runtime/array-methods` | Data-only intrinsic facts shared by compiler proofs and runtime guards; does not initialize the runtime (`optimize.md`) |

Development uses Bun's native `bun check`, with the root engine floor
`>=1.4.3-0`. The root now requests `@types/bun` `^1.4.4`, rather than `latest`;
`bun.lock` resolves both `@types/bun` and `bun-types` to 1.4.4. A frozen install
and the compiler-next/runtime package checks validate this development-only
update; it does not change the browser runtime or emitted programs.

## Rules

- Only `core/parse/` imports `yuku-parser`, only `core/resolve/` imports
  `yuku-analyzer`, and only `core/emit/` imports `yuku-codegen`. Any folder may use
  `yuku-ast` builders, guards and the walker.
- Every yuku package is pinned to the same version.

## Limits to design around

- **The analyzer takes source text, not an AST** (`setFile(path, source)`), and its
  model is a snapshot of that text. So the authored source is analyzed once and its
  AST is never edited (`README.md`, rule 1).
- **TSRX is not supported** by `compiler-next` (`../decisions.md`, 2026-10-19). Only
  `.js`, `.jsx`, `.ts` and `.tsx` files are compiled.
- **`isWrite` and `capturesOf` see reassignment** (`x = 1`, `x++`, `for (x of …)`),
  **not mutation** (`x.push(1)`, `x.a = 1`). Mutation sites are found by
  `core/resolve/` (see `handlers.md`).
- **`strip` does not convert `enum`, `namespace`, `export =` or parameter
  properties.** It reports them and leaves them out. `enum` and parameter
  properties are valid code we must accept (the old compiler rejects `enum`), so
  `core/parse/` lowers them before printing.
- Output text differs from esrap's. Tests compare behaviour, not text, so that does
  not matter.

## Open questions

- Is the native core fine for every place the compiler runs (Vite, the language
  service, CLI)? A WebAssembly core exists (`@yuku-core/wasm`) if not.
