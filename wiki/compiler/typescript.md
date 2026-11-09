# TypeScript 7's API: what it offers, and what to look for

TypeScript 7 is the native (Go) compiler. Its JavaScript package talks to a `tsc` process over a
pipe, synchronously (`typescript/sync`) or with promises (`typescript/async`). The root
`package.json` pins `typescript` to `7.1.0-beta` (2026-11-09). This page records what that API can
do, what the project uses today, and what a later decision to use more of it should check first.
Facts below were read from the package's `.d.ts` files and measured with a probe on this machine.

## What the project uses today

| Where | What | Why |
| --- | --- | --- |
| `bun check` | type-checking the repository | under a second, same errors as `tsc` |
| `tests/reference/typescript.ts` | `api.transpileModule` | the reference's TypeScript is lowered by TypeScript, so it shares no lowering with compiler-next (`testing.md`) |
| `packages/language-service` | TypeScript 6, through the alias `npm:@typescript/typescript6` | it is a `tsserver` plugin, which native TypeScript cannot load (below) |

compiler-next itself does not depend on TypeScript. It parses, strips and prints with the yuku
packages (`toolchain.md`), and lowers enums and namespaces itself (`core.md`).

## The API surface

Entry points are separate exports of the `typescript` package:

| Export | Holds |
| --- | --- |
| `typescript/sync`, `typescript/async` | `API`: the client for one `tsc` process |
| `typescript/ast` | node kinds, `ScriptTarget`, AST types; `/is`, `/factory`, `/visitor`, `/clone`, `/scanner`, `/utils` |
| `typescript/fs` | `serverFS` (`useOS`, `identity`, `fakeStat`, `noop`, `error`) and `createFileSystem` |
| `typescript/vscode` | the editor extension's API |

`API` (constructed with `new API({ cwd, fs })`) has:

- **Without a program:** `transpileModule`, `transpileDeclaration` (a `.d.ts` from one file),
  `createSourceFile` (a parsed tree held in the process), `parseConfigFile`, `parseCommandLine`,
  `createModuleResolver`.
- **Programs:** `createProgram(rootFiles, compilerOptions)` gives a `Program`:
  diagnostics of each kind, `emit`/`emitToString`, `getJavaScriptEmit`, `getDeclarationEmit`, module
  resolution queries, `getSourceFile`. Its project has a `checker` and a `languageService`.
- **Snapshots:** `createSnapshot` and `runWithTemporaryFileUpdate` re-check after an edit without
  rebuilding everything.
- **`batch(...)`:** several requests in one round trip, through each method's `.gen` form.
- **`BuildOrchestrator`:** `tsc -b` builds and cleans.
- **`printer`:** `printNode`, `printFile`.
- **`fromLSPConnection`:** attach to a running editor server's session, so a tool can read the
  same program the editor has.

`Checker` has what the old API had: `getTypeAtLocation`, `getTypeAtPosition`, `getSymbolAtLocation`,
`getResolvedSignature`, `getContextualType`, `isTypeAssignableTo`, `getPropertiesOfType`,
`getConstantValue`, `typeToString`, the intrinsic types (`getStringType`, …), alias resolution and
module exports. A `Type` carries `flags` (`TypeFlags`), and `isUnionType`, `isLiteralType`,
`isStringLiteralType` and the like.

`LanguageService` is small: completions, references, import edits, signature usage. Diagnostics
and code fixes for a custom rule are not part of it.

### Things that differ from TypeScript 6's API

- **Compiler options are numbers.** `module: 'esnext'` makes the process panic; pass
  `ModuleKind.ESNext`, `ScriptTarget.ESNext` (from `typescript/ast`) and `JsxEmit.Preserve`.
- **Every query is a round trip** to another process. Types and symbols come back as handles,
  cached per project. Use `batch` or the array forms (`getTypeAtLocation(nodes[])`) for many.
- **In-memory files come through `fs` callbacks** on the `API`, not a host object. Return
  `serverFS.useOS` to let the process read the disk itself (as for `lib.*.d.ts`).
- **Each `API` owns a process.** Call `close()`, or keep one for the whole process as
  `tests/reference/typescript.ts` does.
- **No plugins.** `compilerOptions.plugins` is "parsed only so tools can report that native
  TypeScript does not support them".

## Measured (2026-11-09, this machine)

| Step | Time |
| --- | --- |
| `transpileModule`, first call (starts the process) | about 9 ms |
| `transpileModule`, later calls | about 1 ms |
| `createProgram` of one in-memory file with the default libraries, process start included | about 110 ms |
| first `getTypeAtPosition` + `typeToString` | about 3 ms |
| each later type query | about 0.2 ms |

The probe gave `string` for a template string, `number`, and `string | undefined` for the three
queries it made, which is what the editor shows.

## Where compiler-next could use it

Each of these is a candidate, not a plan. None is needed for correctness: the compiler must
stay right for plain JavaScript, which has no types, so a type can only make output smaller or
add a warning.

- **Smaller output from known types.** A `class` value always a string does not need the runtime's
  `classValue` normalization; a text known to be a string or a number needs no `null` handling; a
  value typed as a primitive cannot be edited in place, so no edit tracking reaches it.
- **Warnings the compiler cannot give from syntax.** A component whose first parameter is not
  destructured and is used as text (`function Count(value)`, `open-issues.md`), a prop passed that
  the component's type does not declare, a source read the read path cannot name.
- **The language service.** The rules in `packages/language-service` could run against the native
  program through `fromLSPConnection` or a separate program, as a linter or a small editor server
  of their own, rather than as a `tsserver` plugin.
- **Declarations for compiled packages.** `transpileDeclaration` writes a `.d.ts` per file without a
  program.

## What to check before relying on it

1. **Stability.** `7.1.0-beta` is a beta, and npm's `latest` was still 7.0.2 when this was written.
   A beta's API can change before release. Pin an exact version.
2. **Speed in the build.** 110 ms per program, plus about 0.2 ms per query, is fine for a whole
   build and too slow per file in a dev server's hot path. Measure with a real project, and keep
   one program per build (snapshots for edits).
3. **Types are not trustworthy enough to change behavior.** `any`, a cast or a wrong `.d.ts` makes a
   type lie. Only use a type where a lie costs size, never correctness: for example, use `classValue`'s
   fast form only when the value is a string at runtime too, or keep a runtime check behind it.
4. **Plain JavaScript gets no benefit.** A `.js` or `.jsx` file has no annotations. Any type-based
   path needs its untyped fallback, which the cases already test.
5. **Plugins.** The language service cannot move to TypeScript 7 as a plugin. It stays on 6 until it
   is rebuilt on one of the ways above, or TypeScript adds plugins back.
6. **Reference independence.** The reference may use TypeScript (`tests/reference/typescript.ts`).
   If compiler-next starts using TypeScript too, the reference must not then use the same calls for
   the same decision, or a bug in either is in both (`testing.md`).
