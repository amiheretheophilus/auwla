# Linking: several modules

**Folder:** `link/` (native module boundary built; native packages compile in the app's graph).

## What it does

Compiles a module graph together, so a component, state or source imported from
another file behaves as if it were local.

Phase 9 starts with independent reference cases, then fixes the uncovered
compiler boundaries. Existing component, state and source machinery remains
responsible for reactivity. Linking preserves native ESM bindings and namespace
objects; it does not introduce a second state model.

## Files

| File | What it owns |
| --- | --- |
| `core/resolve/exports.ts` | Cached value-export identities: live bindings, captured default expressions, namespaces, erased types, star conflicts and cycles |
| `core/resolve/exports.test.ts` | Independent export-fact checks, including a default capture conflicting with its original live binding |
| `core/resolve/imports.ts` | Existing module-path resolver, extension/index probing and caller-provided resolution |
| `link/modules.ts` | Native public re-export boundaries that exclude compiler-only exports; collision-free private siblings and original diagnostic provenance |
| `link/captured-plan.ts` | One value cell per captured default expression, shared by importing bindings and namespaces |
| `link/captured-dom.ts` | Native default evaluation and contextual naming, with existing shared mutation roots for the captured value |
| `link/specifiers.ts` | A bare or alias specifier the caller's `resolveImport` maps to a compiled module is printed as a relative path to it, so output loads without the resolver (`project.md`, `server.md`) |
| `link/open-namespaces.ts` | Reads through a namespace that came from `import()`: registering the module, asking the runtime before a read, and lowering an optional chain that continues past one |
| `features/state/shared-plan.ts` | Shared binding readers and the versions a compiled namespace can observe |
| `features/state/shared-dom.ts` | Namespace version observation and guarded mutation inputs, preserving the native receiver and avoiding uninitialized export reads |
| `tests/cases/linking.test.ts` | Reference and optimized/general comparisons for live/default exports, namespaces, cycles, collisions, components and readiness |
| `tests/cases/linking.graphs.test.ts` | Dynamic imports (lazy state, components, sources, effects, computed specifiers, top-level `await`), star exports meeting code outside the graph, and cycles of state, components, sources and re-exports |
| `tests/cases/linking.packages.test.ts` | Source-graph oracle for separate package compilation: forwarded status/payload use, returned sources, shared package state and retained component state |
| `tests/cases/linking.installed.test.ts` | Packages under `node_modules`, imported by bare specifiers: subpaths, scoped names, two copies, hoisted dependencies, cycles, self-imports, `.js` names for TypeScript source, and dependencies outside the graph |

## Rules

- One `yuku-analyzer` `Analyzer` holds every file of the build.
  `binding.definition()` and `module.resolveExport()` follow imports and re-exports;
  the resolver option maps Vite aliases.
- Each module gets a **summary**: its exported components, state, sources and
  helpers, and the graph facts other modules need. A module reads other modules
  only through summaries.
- **Module state** (a top-level binding that is written) is state shared by every
  component that reads it. The same classification rules apply
  (`state-and-derived.md`).
- When a file changes, only that file and its dependents are compiled again
  (`module.dependents`). This incremental API is still pending; current calls
  compile the supplied graph together.

## Native module boundary

`export { count as default }` forwards a live binding. `export default count`
captures a separate value at that statement. The analyzer currently follows both
to `count`; the value-export index preserves the distinction through named and
star forwarding. Default literals and anonymous expressions remain runtime
exports even when they have no analyzer binding. Type-only exports are erased.
Conflicting star bindings are absent from namespaces; an explicit export wins.
Indexes are built once per immutable analyzer module, rather than rescanning
every export for each imported binding. Incomplete cyclic queries are not cached.

A compiled namespace conservatively observes the shared exports of its target
module. Observation records versions through the existing runtime collector and
does not read the export values. The original namespace object is still the
receiver of member calls, including computed members and methods using `this`.
Its identity, keys, descriptors and host-native prototype are retained. Before a
cyclic producer has executed, the observer's hoisted key slot is undefined and
cannot create a temporal-dead-zone error of its own.

Opaque calls through a namespace observe separate initialized data roots through
these helpers, rather than enumerating the namespace. Each read keeps native
value identity; allocating a fresh array of values would falsely report every
unchanged call as a replacement. Hoisted readiness flags guard cycle-time reads.
Ordinary namespace reads record versions without requesting these values.

A captured default gets its own watched value, so object mutation remains live
after its original variable is replaced. Imports use the existing mutation
planner and observer to notify actual data roots, without a mutable import clock.
The captured expression still evaluates once at its native export position.
Anonymous default expressions retain the native contextual name `default`.
Callable identity proofs remain separate from reactive binding forwarding.

Compiler reader/observer exports cannot appear in authored namespace reflection.
In graphs that consume compiled namespaces, modules needing private exports get
an implementation sibling and a native public re-export facade at their original
path. Authored imports keep that public path; generated helper imports reach the
implementation. Private paths avoid every authored/generated path. Public
facades contain no authored setup and do not duplicate module instances. They
can be removed by ordinary bundling. Named-import graphs without namespace use
keep their existing output shape.

The reference uses its own native module loading and dependency snapshots, with
no production linking helpers. Export specifiers remain native identifiers.
During static import evaluation it defers namespace descriptor snapshots until
the modules have initialized, before mounting or handlers. This permits a cycle
to call a hoisted export while another export is still uninitialized. Native
namespace detection is test-only (`node:util`); prototype assertions use an
uncompiled native-module control because Bun and Node expose different prototypes.

## A namespace from import()

`import * as store` is a binding, so `store.count` is a known read and observes the module
(above). `kit = await import('./store')` is only a value: `kit.count` looks like a property
of any object, and a native namespace reports no reads. The page would not follow the state,
though JavaScript and the reference show it. Handed-off functions work the same way:
`onClick={kit.increment}` writes state nothing on the page knows it read.

So a module reached by `import()` that exports something that can change (`openNamespaces`,
`core/resolve/index.ts`) registers its own namespace with the runtime, with how to observe
it. A property read of any value that might be one asks the runtime first:

```js
// In store.mmd.ts, the implementation of the module:
import * as _namespace from "./store.ts";
_namespaces.observeNamespace(_namespace, () => { _observe_count(); _observe_twice(); });

// Wherever a value is read:
_namespaces.readNamespace(kit).count
```

- **The module registers itself.** If the importer named the module's observers, it would have
  to import them, loading the lazy file eagerly and undoing the code splitting.
- **A lazy page costs nothing.** A module exporting only components, functions and constants
  has nothing to observe, so nothing is emitted, for it or for the rest of the graph.
- **Only such a graph pays.** With one, every property read of a value the compiler cannot
  identify gains one `WeakMap` lookup.
- **A specifier worked out at run time** could name any module, so every module counts as
  reached (`dynamicallyImported`). The analyzer does not record these imports, so they are
  found by syntax (`hasComputedImport`).
- **`const { count } = kit`** reads as `kit.count` does, and is observed the same way.
- **An optional chain that continues past the read** is rebuilt without `?.`, as
  `(t = a) === null || t === void 0 ? void 0 : read(t.b).c`, since `read(a?.b).c` would throw
  where the language stops at `a`. `a.b?.()` becomes `t.call(r)`, keeping its receiver. A chain
  that is just `kit?.count` needs none of this: it stays `read(kit)?.count`.
- **`(a?.b.c)()`** keeps its native form, since parentheses keep `a.b` as the receiver and the
  rebuilt one could not. What is read there is the function to call, whose own reads are
  observed when it runs.
- **Code the compiler does not compile**, such as an npm package handed the namespace, reads it
  without asking. That code's reads are opaque like any other (`state-and-derived.md`).

The reference gets these from re-rendering. It needed two fixes of its own: a file loaded after
mount never had its memos or effects run, since no app claimed them; and a module memo did not
follow reads inside a helper from another file, while the compiler and JavaScript do (`$traced`,
`ModuleEffects.adopt`).

## Cases and validation

`tests/cases/linking.graphs.test.ts` covers the shapes a package graph can take beyond one
import of one name. The cases found the namespace bug above, the two reference gaps, and that
a pattern was not treated as a property read (`state-and-derived.md`, "Opaque property reads").

The 27 comparisons in `tests/cases/linking.test.ts` establish the first slice:
named/star/default forwarding, captured default values, direct/re-exported and
computed namespaces, method receivers, native namespace shape and identity,
diamond/cyclic graphs, hoisted calls before initialization, private-name/path
collisions, retained component state and source readiness without duplicate
requests, captured-object edits after replacement, opaque namespace mutations
and anonymous default naming. Every comparison has an explicit expectation and runs with optimizer
passes enabled and disabled. Existing case expectations remain unchanged.

Original star-export edges remain in public facades, so the native loader still
handles unknown external names and conflicts. AST origin metadata distinguishes
generated helper imports from authored imports: a forwarded public export with
a helper-like name must never be redirected to compiler metadata.

Eleven resolver checks independently cover live versus captured defaults,
anonymous runtime values, type erasure, conflicting exports, cyclic diamonds,
namespace forwarding, unresolved packages and immutable authored syntax. The
cached-conflict check preserves an ambiguity through another star barrel. The
24-level repeated-star diamond guards against expanding every possible path;
type-only namespace imports do not request runtime observation or facades.

## Native packages

A native package ships its source, and the app compiles it as part of its own graph
(`../decisions.md`, 2026-11-05). So a component, state or source from a package behaves
as if it were local, through the same code path and the same cases, and row lists and
closed lists work across the package boundary. There is no semantic artifact, integrity
hash or runtime compatibility check, since the app's own compiler and runtime build it.
An earlier plan shipped compiled output with JSON metadata. That needed a second path in
every feature that crosses a module, and stopped optimizations at the boundary.

`tests/cases/linking.packages.test.ts` holds the contract. Status-only parameters keep
their source handle and run during initial loading and refresh. Mixed status/payload
parameters also keep the handle, but the call waits for payload readiness. Forwarded
source factories retain source identity, replacement and request counts. Package state
remains one shared owner while each component instance keeps its own local state. A
factory's value follows a change the compiler can see, and its parameters are state once
a later call changes them. The reference links its own untouched inputs and uses no
compiler linking code.

### Publishing and installing one

The author writes `.lib.config.ts` and never an `exports` map (`../decisions.md`):

```ts
export default { entry: './src/index.ts', subpaths: ['./src/public'], source: true } satisfies LibraryConfig;
```

`entry` is the file exporting the public API, and each file under a `subpaths` directory is
a public subpath. `memoized-dom package` then generates the package to publish:

- the files the public entries reach, exactly as written, and nothing else;
- a `package.json` with an `exports` map pointing at that source, and the marker
  `"memoized-dom": { "source": true }`;
- declarations, unless turned off.

`source: true` is temporary. `packages/utils` and the tests of the older output still use
compiled output with an artifact, and it becomes the only behaviour once those go.

Packaging compiles the result once, so a package that cannot compile never gets published,
and the output says which framework packages to add as peers, since `$fetch` needs no import.
It stops on an import that would break for a user: a dependency not listed, a missing file,
a file outside the package, a project-only specifier (`#x`), and `aliases`. Options that
describe compiled output are refused.

An app installs the package and imports it. The plugin finds the marker by reading the
manifests of the app's dependencies, following native packages through each other but not
through an ordinary package (`packages/vite/src/graph/native-packages.ts`). It keeps those
packages out of prebundling, which would give the app a second copy of their state, and out
of SSR externals. Their files then count as the app's own source (`acceptsSource`). Vite
never runs an installed package's config; it only reads its `package.json`.

A package linked from the same workspace has nothing built and no `exports`, and needs
neither. When a dependency's real path is outside `node_modules` and it has a `.lib.config.ts`
with `source: true`, the plugin reads that config and aliases each public import to its source
file. An edit reaches the dev server with no packaging step, and a stale `dist` is ignored.
A published package has no such file, and one shipping it anyway stays inside `node_modules`,
pnpm's store included, where it is not read.

TypeScript cannot find those imports without help. Three things were tried against a real
type check. A declared module in `.memoized` cannot work: `declare module` rejects relative
and absolute paths alike (TS2439), which `skipLibCheck` hides, leaving every import empty.
Writing `types` into the author's `package.json` breaks the promise that it is only read.
Generated `paths` need every app to change its tsconfig. So the plugin writes `index.d.ts` and
`tabs.d.ts` in the package's root, where TypeScript looks by itself. They hold relative paths
only and can be committed. A file the author wrote at such a path is left alone, and
`.memoized/linked-types.json` in the package records what to remove when a subpath goes.

In an app this is compiled by the old compiler for now, since `packages/vite` moves to
compiler-next in Phase 10. Nothing here depends on which compiler it is.
`packages/vite/tests/native-package.test.ts` and `native-package-workspace.test.ts` cover the
whole path, including built apps run in happy-dom, and a real type check. Not covered: a dev
server in a real browser, since this machine has no Chrome, so live edits are checked by
what the server returns rather than by a page updating; and editing a file of a package
downloaded into `node_modules` during development, which Vite does not watch.

### Installed copies and specifiers

The compiler's unit is a path. The build tool turns a specifier into one, through
`resolveImport`, after applying a package's `exports` map and following symlinks. Nothing
in the compiler knows about `node_modules`. So:

- A subpath and a barrel that reach the same file name one module, with one state.
- Two copies at two paths are two modules, each with its own state and component
  identity, even with every name the same. Two packages sharing a hoisted copy share it.
- A generated reader import is a relative path to the owning file, not the authored
  specifier, because `exports` need not list that file. The build must therefore give a
  native package's files stable paths, and must not prebundle them.
- A dependency outside the graph stays an ordinary import, including through `export *`.

Without `resolveImport`, relative specifiers probe extensions and index files, and a
`.js`, `.jsx`, `.mjs` or `.cjs` name also finds the TypeScript source it compiles from
(`./store.js` for `store.ts`), since ESM requires that spelling. A file of exactly the name
asked for wins. Absolute paths stay absolute.

`tests/harness/installed.ts` models Node's lookup over a case's files, and the files are
written out as given, so Bun then resolves each specifier by itself. `exports` maps are not
modelled, since the compiler never sees them.

### Size

A package's output should be in proportion to its source. A sample of ordinary package code
(a barrel, components with children and a list, a store, two factories, pure helpers, and
an app using them) measures this: 4.7 KB of source, 15.8 KB minified from the old compiler
without runtime, and from compiler-next 42.1 KB, now 34.2 KB:

- A prop nothing assigns needs no separate copy of its parent's value (`props/dom.ts`), about
  100 B a prop on its own and less inside a bundle. A leaf component fell to 2,041 B.
- A module that cannot touch a source skips source flow, even when others in the graph use
  it (`freeOfSources`, `reach.ts`). A leaf component fell from 3,485 to 2,239 B.
- A factory or block with nothing to replay uses the `simple` owner form, with no build
  scope, refresh or completion (`shared-dom.ts`). `createToggle` fell from 1,393 to 659 B.
- A plain function replays only what the compiler can see change
  (`state-and-derived.md`, "Plain functions").

Moving each component's opening lines into one runtime call, `beginComponent`, was tried and
rejected. It adds about 110 B raw and 50 B gzip to a typical app: the shared function costs
more than a component saves, and at 60 components the raw size only breaks even and gzip is
still worse. Repeated lines already compress well. Judge this kind of change by gzip.

Where a bundle's bytes are, minified before gzip:

| Bundle | Total old | Total new | App | Runtime | Data |
| --- | ---: | ---: | ---: | ---: | ---: |
| FlowOS | 114.3 KB | 129.9 KB | 26.2 → 31.9 | 51.7 → 55.0 | 36.4 → 43.1 |
| `composition` | 10.2 KB | 21.1 KB | 0.7 → 1.3 | 9.5 → 19.8 | none |

A real app has no one problem. A small one does: `<Label value={count} />` adds about 8 KB to
`owner-counter`, since a child component at a fixed position, and `{value}` inside it, go
through the path for a value of any kind, which brings `render-value`, `mutation` and even
the list modules into an app with no list. Taking them out needs two things, neither built: a
direct path for a known component at a fixed position, and a proof that a prop is always a
primitive, following every call of its component. A real app pays for those modules anyway.

A fixed tag no longer needs a computation (`isFixedTag`, `core/plan/index.ts`). `<Label />`
counted as reading `Label`, which lives outside the component, so the site collected reads
with nothing to collect: 3 KB off `composition`. The tag must be a module-level function that
nothing reassigns, in its own file or the one it came from. "Nothing assigns it" alone is
wrong, since a tag derived from state, a prop or a function declared in a callback changes
with no assignment; the `tags:` cases in `components.test.ts` caught that.

`packages/utils/src/optimistic.ts` is not the measure: 8 KB of source compiles to 100 KB,
against 3.4 KB published for all of `utils`, because `$read(result)` hands it a raw handle
and its values all become possible sources. It is runtime-level code. Calling an internal
function instead of `$read` brings it to about 35 KB.

## Installed packages run opaque

An ordinary npm package is not compiled (`../decisions.md`, 2026-11-05). This page's work
is linking for native packages.

The old compiler's opaque path is why third-party compilation existed: a reader of an
opaque value was re-checked every frame. compiler-next checks only at the call.
`bench/third-party-runtime` compares them on real Chromium, with correct results in every
mode. One local run at 128 instances, 3 samples, so only a guide (microseconds; the VM is
still to repeat it):

| Scenario | Measure | Old opaque | Old compiled | New opaque |
| --- | --- | ---: | ---: | ---: |
| `local` | idle frame | 108.7 | 0.3 | 0.3 |
| `local` | click | 56.6 | 4.5 | 23.7 |
| `shared` | idle frame | 99.8 | 0.2 | 0.2 |
| `shared` | click | 125.1 | 37.5 | 481.9 |
| `fetch` | idle frame | 2,843.7 | 0.3 | 0.3 |
| `fetch` | click | 2,916.8 | 11.8 | 34.3 |

`shared` is slower because the snapshot walks all of `models` (`../open-issues.md`).

To find compiler bugs, real packages in `node_modules` were compiled whole, one process
each. This is the whole-rewrite path, which is not how they run:

| Package | Modules | In | Out | Time |
| --- | ---: | ---: | ---: | ---: |
| `mitt` | 1 | 0.3 KB | 1 KB | 37 ms |
| `pathe` | 2 | 13 KB | 763 KB | 2.2 s |
| `zod` | 10 | 146 KB | 643 KB | 1.6 s |
| `hono` | 26 | 70 KB | 284 KB | 0.8 s |
| `acorn` | 1 | 228 KB | 842 KB | 1.8 s |
| `animejs` | 50 | 405 KB | 2,192 KB | 7.4 s |
| `gsap` | 3 | 232 KB | 1,504 KB | 13.4 s |
| `fast-check` | 2 | 378 KB | 2,312 KB | 7.5 s |
| `happy-dom` | | | | over 180 s |

The first run also found four crashes and four files that did not parse. All were
general bugs, now fixed, with cases: `groupsOfModule` and `cannotReplay`. "Valid" here
means the output parses; running these packages against their native behaviour has not
been done yet.

What this says for native packages too:

- **Compile time is not a problem for real code.** On `gsap`, parse, resolve and classify
  took about 0.6 s and emit 14.4 s, but `gsap` is opaque in a real app and that is its code's
  shape, not its size. An app of 25 to 400 generated components (17 to 270 KB, 16 times the
  code) took 388 ms to 7.0 s, 18 times the time, against the old compiler's 328 ms to 5.9 s.
  `packages/utils` (8.6 KB) took 211 ms against 39 ms, and FlowOS (8.6 KB) 157 against 156 ms.
  One local run, best of three.
- **A native package costs an app little.** `bench/package-compilation`, one local run: a
  package of 9, 33 and 65 files added 23, 37 and 70 ms to compiling the app. The old
  compiler's linked source took 42, 69 and 115 ms for the app and package together, against
  35, 46 and 79 ms here. Its artifact link took 11, 7 and 6 ms, which is what compiling in the
  graph gives up. `bench/linker` shows the new compiler at 1.2x the old at 16 modules and 1.8x
  at 256, the one place compile time may grow slightly faster than the graph.
- **A consumer needs no second path to judge a package call.** `InputQueries.callFacts`
  follows visible functions across files, and reports what they read and write, with
  `opaque` when it cannot tell.
- **Rewriting every local costs the most.** `aliasBindings` and factory owners apply
  whether or not state ever reaches the code.

## Inputs and outputs

- Input: the caller's source graph and `resolveImport`, using the existing
  single analyzer and shared semantic graph.
- Output: JavaScript at every supplied public path, plus private implementation
  siblings only when a namespace boundary needs them. Diagnostic paths/sources
  still identify the authored module.

## Where to add things

Add value-export facts to the shared resolver, source-graph boundaries to
`link/`, and cases to this page's case file. Keep state/source behavior in its
existing feature. `pipeline.ts` alone orders parsing, resolution, graph/planning,
optimization, emission, namespace linking and printing.

## Remaining Phase 9 work

- A package's size (see "Size").
- `bench/linker` and `bench/package-compilation` are ported, and their correctness checks pass
  locally. Timing them on the VM is Phase 9 exit work.

## Not designed yet

These are ported from `packages/compiler` once the core works, each with its own
page:

- `$routed` (routes and `route-to` are built: `routes.md`);
- server functions and their client stubs;
- server pages.
