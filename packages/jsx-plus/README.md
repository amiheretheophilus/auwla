# JSX+ syntax package

Prototype on `prototype/jsx-plus`. The specification and implementation map are
in [wiki2](../../wiki2/README.md).

This package owns the additional authoring syntax. `normalize()` returns standard
TSX, syntax views and exact copied-span mappings. `compile()` passes that TSX to
the existing `@memoized-dom/compiler-next` API, which owns reactivity, refs, lists,
optimization and runtime output. Checking also uses its public read-only analysis
entry; extended syntax and checking transformations stay in this package.

```ts
import { compile, normalize } from '@memoized-dom/jsx-plus';

const source = 'export function App({ name }) { return <p>"Hello "; name</p>; }';
const normalized = normalize(source); // <p>{"Hello "}{name}</p> in the module
const javascript = compile(source, { moduleId: './App.auwla' });
```

[examples/counter.auwla](examples/counter.auwla) is a complete small example,
compiled and clicked by the package's execution tests.

For fuller authoring, open [the task board](examples/task-board/App.auwla). It
includes search/status filters, a form, refs, derived lists/counts, direct `if`,
direct `for` loops in the markup (the filter buttons and the task rows) and
native `${...}` template interpolation. Run its local browser preview:

```text
bun run examples/task-board/preview.ts
```

Open `http://127.0.0.1:3030`. [The examples guide](examples/README.md) includes
build-only/type-check commands and the source walkthrough. Checks read the actual
`.auwla` file and exercise the main authoring flow in both compiler modes.
Its rows are written as `for (const task of visible) { <li key={task.id}>...</li> }`
directly in the markup. Direct loops accept any iterable and lower to
`Array.from(iterable, (binding) => row)`. With optimization on, compiler-next
shows a keyed single-element loop body through compiled rows, as it does for
`.map()`. See [direct loops](../../wiki2/syntax.md#direct-loops).

Extended attributes accept `aria-label=("Remove " + task.title)` alongside
existing `aria-label={...}`. Parentheses delimit an ordinary value; event callbacks
stay explicit, such as `onClick=(() => removeTask(id))`. The actual task-board
code and native TypeScript completion/edit checks exercise this form.
Single identifiers can omit delimiters entirely: `onClick=addTask` becomes
`onClick={addTask}`, retaining native event arguments. Actual app checks and an
applied LSP handler rename cover this spelling. Calls/members/other expressions
still use parentheses or braces.

For whole apps, JSX+ is a compiler-next **source language**, not a build tool:
pass `auwla` to compiler-next and it compiles, imports, maps and hot-updates
`.auwla` files exactly as it does `.tsx` files. JSX+ reads no files and uses no
Bun or Node API ([architecture](../../wiki2/architecture.md), DX-39).

```ts
import { auwla } from '@memoized-dom/jsx-plus';

compileModules(files, { languages: [auwla] });                        // compiler-next
createProject({ entries: ['./main.ts'], host, languages: [auwla] });  // projects and apps
memoizedDom({ client: './main.ts', languages: [auwla] });             // compiler-next's Bun plugin
memoizedDom({ clientEntry: 'main.ts', compiler: 'next', languages: [auwla] }); // @memoized-dom/vite
```

[The notes example](examples/notes/) has three `.auwla` components importing each
other, with and without the extension. Tests run it through compiler-next's project
and Bun plugin in both modes, and through the Vite plugin's build, dev server and
hot updates. [The team example](examples/team/) writes routes, lazy route pages,
`$fetch`/`$track`, `$routed` and effects in `.auwla`, checked in both modes and
split into chunks by both Bun and Vite. `compile()` is the one-module convenience;
a `.tsx` `moduleId` keeps its existing JSX semantics. Server functions written in
`.auwla`, SSR, backend configuration and isomorphic execution remain future work. `normalize()`
itself preserves host code outside markup, including backend-style imports.

The initial TypeScript content mapper is registered in this package's manifest.
It shares `normalize()` through the separate `@memoized-dom/jsx-plus/checking`
entry, returning TSX and exact copied spans without DOM compilation. The valid
[checking example](examples/checking/App.auwla) and its
[configuration](examples/checking/tsconfig.json) run with the pinned TypeScript:

```text
bun ../../node_modules/typescript/lib/tsc.js --project examples/checking/tsconfig.json --runExternalCode --pretty false
```

`examples/checking/tsconfig.error.json` intentionally selects a type error and
exits two. CLI/LSP tests verify the original UTF-16 error location and a safe ref
rename. `vscode-jsonrpc/node` provides stream transport; it does not require the
VS Code editor. Complete reactive/ref flow typing remains open.
Checking preserves native host recovery and can insert checking-only closers or
quarantine damaged markup ranges, retaining authored errors and exact editor
spans. Selected unfinished tags, attributes and loop headers recover; other
structural damage has a conservative fallback. Builds remain strict. See
[recovery](../../wiki2/recovery.md). The mapper retains one latest exact result per open
project; edits replace it and close/reopen discards it. See
[tooling](../../wiki2/tooling.md) and [cache evidence](../../wiki2/mapper-cache.md).

The separate [VS Code adapter](../editor-vscode/README.md) consumes the shared
`./editor` metadata/mapper contribution and `./editor/grammar` build helper.
[Editor assets](editor-assets/README.md) remain reusable without that adapter.
The user reported the task board working in desktop VS Code with the locally
installed VSIX (2026-11-11); marketplace packaging remains unverified.

Quoted child text also supports `{expression}` interpolation, for example
`<p>"Count: {count}"</p>`. It normalizes to a native template and retains exact
expression mappings for completion, hover and rename. Use `\{` for a literal
opening brace. The counter uses this spelling; see [the grammar rules](../../wiki2/spec/grammar.md#quoted-text-interpolation-g-interp).

`bun run tests/probe-flow.ts --strict` is the separate checking-flow target gate.
It passes all 34 current targets, including the four original narrowing gaps.
The primary TSX view preserves editor identity and synchronous narrowing; selected
reactive regions use native diagnostics from a supplemental checking view.
Supplemental mappings disable editor edits, and generated scaffolding is unmapped.
The [flow profile](../../wiki2/checking-flow.md) records sources, routing, runtime
evidence and the limits that keep full TOOL-05 acceptance open. Receiving variable
and JSX contexts retain assignability errors. Checking-only typed identity calls
validate seeds before widening them, preserving contextual parameter types and
authored argument diagnostics. Body-assignment and generic-helper examples also
execute correctly in both compiler modes.

The opt-in `@memoized-dom/jsx-plus/checking/facts` entry now obtains snapshots
through compiler-next's public `./analysis` entry. It maps identities and ranges
without DOM emission, distinguishes exact/enclosing/unmapped locations and refuses
shifted lowering offsets. The active flow planner consumes the same public
compiler facts directly in normalized coordinates.

Run focused checks from this package:

```text
bun check
bun test
```

The host tokenizer/parser remains yuku, pinned to the same version as compiler-next.
Equal-width masks are internal scanning aids; emitted code is built from copied
authored spans and generated syntax. Generated braces have no editable authored
mapping. These frontend mappings are not final-JavaScript source maps.

Fragment parsing uses an async/generator context only inside the parser, then
validates the normalized complete module in its authored context. No synthetic
function is emitted around children. Semicolon-separated expression chunks and
cached conditional child bodies preserve object/function/class values after
siblings. Host-context tests check native yield/await behavior separately from
the reactive compiler's execution tests.

This is an initial implementation, not full-language acceptance. Its tests run
the current spec fixtures and additional lexical/mapping cases. Scanner reparses
and complete host-expression coverage need further work; no performance, editor,
SSR/adoption or backend-support claim follows from these tests.
