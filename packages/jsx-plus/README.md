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

`compile()` currently adapts one UI module. Existing `.tsx` input explicitly
named through `moduleId` retains its existing JSX semantics. Multi-module `.auwla`
resolution, Vite integration, backend configuration
and isomorphic execution remain future work. `normalize()` itself preserves host
code outside markup, including backend-style imports.

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
VS Code editor. IDE activation, complete reactive/ref flow typing, partial-file recovery
and mapper caching remain open. See [tooling](../../wiki2/tooling.md).

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
