# JSX+ syntax package

Prototype on `prototype/jsx-plus`. The specification and implementation map are
in [wiki2](../../wiki2/README.md).

This package owns the additional authoring syntax. `normalize()` returns standard
TSX, syntax views and exact copied-span mappings. `compile()` passes that TSX to
the existing `@memoized-dom/compiler-next` API, which owns reactivity, refs, lists,
optimization and runtime output. Existing compiler-next files are not modified.

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
resolution, Vite integration, the TypeScript content mapper, backend configuration
and isomorphic execution remain future work. `normalize()` itself preserves host
code outside markup, including backend-style imports.

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
