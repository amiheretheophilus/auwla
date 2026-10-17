# Packaging compiler-aware libraries

Memoized DOM packages may ship a small semantic artifact beside their ordinary
JavaScript and declarations. The artifact lets the application compiler retain
reactive relationships hidden behind a package import without recognizing the
package or helper by name.

This API is experimental. It supports ordinary named functions and a deliberately
narrow component boundary. Exported compiler-owned package state is not portable.

## What package consumers do

Nothing beyond a normal import:

```ts
import { pending, optimistic } from '@memoized-dom/utils';
```

The Memoized DOM Vite plugin resolves that bare import, finds the package
manifest, loads its artifact, and watches both files during development. The
artifact is compiler metadata, not executable code, and does not add a runtime
import.

Artifacts are treated as untrusted build input. Their format version, function
facts, component contracts, argument indexes, property paths, and HTTP method
metadata are validated before linking. An incompatible or malformed artifact
fails at the exact field path instead of entering the graph with partial facts.

Hosts which call `compileModules` or `compileModulesDetailed` directly do not
perform filesystem discovery. They must read the artifact and pass it through
`experimentalPackageArtifacts` themselves.

### Multiple installed copies

Vite keeps artifact selection attached to the importing module, just like its
ordinary JavaScript resolution. Two modules may therefore import the same bare
specifier and resolve to different installed copies with different package
artifacts. Each semantic copy receives a reproducible digest derived from the
validated artifact; absolute installation paths do not enter compiler identity
or generated output. Copies with identical semantic artifacts may share that
compiler identity while their ESM imports still resolve normally.

Low-level hosts which need the same behavior pass importer-specific
`experimentalPackageImports` entries. Normal Vite users and package consumers do
not configure this and continue to write ordinary imports.

## Package layout

Publish the generated artifact with the package's normal output:

```text
my-package/
  package.json
  dist/
    index.js
    index.d.ts
    memoized-dom.package.json
```

Declare its path in `package.json`:

```json
{
  "name": "my-package",
  "files": ["dist"],
  "memoized-dom": {
    "artifact": "./dist/memoized-dom.package.json"
  }
}
```

The path is relative to that manifest and must remain inside the package. The
artifact entry name must exactly match the bare import specifier. A package
which exposes both `my-package` and `my-package/status` needs one entry for each
specifier it wants the compiler to understand.

## Generating the artifact

Run package compilation after building `@memoized-dom/compiler` and before
publishing the package. A package may keep this in a build script:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { experimentalCompilePackage } from '@memoized-dom/compiler';

const modules = {
  './index.ts': await readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
  './status.ts': await readFile(new URL('../src/status.ts', import.meta.url), 'utf8'),
};

const compiled = experimentalCompilePackage(modules, {
  packageEntries: {
    'my-package': {
      moduleId: './index.ts',
      exports: ['pending', 'status'],
    },
  },
});

await writeFile(
  new URL('../dist/memoized-dom.package.json', import.meta.url),
  `${JSON.stringify(compiled.artifact, null, 2)}\n`,
);
```

`exports` is recommended when the public entry also exposes values or types
which are not compiler-aware. Every selected name must resolve to an ordinary
named function or component export.

Publish JavaScript produced by the same compilation. Helpers whose bodies need
payload lowering and every component rely on that output; generating an artifact
from source and then publishing an unrelated transpilation can make the metadata
disagree with the executable module. For a single-module package:

```ts
await writeFile(
  new URL('../dist/index.js', import.meta.url),
  compiled.output['./index.ts']!,
);
```

`compiled.maps` contains one authored source map per emitted module. A package
build should pass those maps into its bundler, or write the matching `.js.map`
file and append its `sourceMappingURL` comment. Choose compiler module IDs which
remain meaningful from the published map (for example `../src/index.ts` when
the map is in `dist`), or rewrite `map.sources` while packaging. The maps retain
`sourcesContent`; the semantic artifact itself is not a source map.

Multi-module packages must write the corresponding output modules or bundle
those compiler-produced modules afterward. Generate declarations separately;
the semantic artifact does not replace `.d.ts` files. Consumers continue to
load ordinary ESM through the bundler.

### Barrels and bundling

Public entries can use ordinary explicit named re-exports, including aliases:

```ts
// src/index.ts
export { Button as ActionButton } from './Button';
export { pending } from './status';
export type { ButtonProps } from './Button';
```

Include the referenced implementation modules in the package compilation.
Helper relationships and component adoption capabilities follow their defining
exports through these barrels. An application can also re-export the installed
package from a local barrel. Type-only exports do not create runtime edges.
Use explicit names: `export *` and namespace re-exports are not supported as
compiler-aware publication entries.

Bundling and minification happen **after** package compilation. Keep framework
imports external, and declare the matching runtime/data dependencies as peers
when the emitted package uses them; do not embed another runtime in the library
bundle. Declare all public subpaths in both `exports` and `packageEntries`.
An ESM-only entry such as `{ "import": "./dist/index.js" }` is supported; a
`require` export is not necessary. Vite follows the actual optimized dependency
entry back to its package metadata during development and discovers metadata for
externalized ESM entries during SSR. The JavaScript still uses normal Vite/ESM
resolution; the artifact does not replace or disable dependency optimization.

Use `sideEffects: false` only if the library genuinely has no import-time side
effects. It allows unused exports to disappear from the consumer's output.
Do not strip required initialization just to reduce bundle size. Generate
declarations from the authored TypeScript/TSX so consumers keep the original
prop and helper signatures, rather than the compiler's internal factory ABI.

### Publication regression

From this repository, after building the framework, run:

```sh
cd packages/vite
bun test --isolate ./tests/package-publication.test.ts
```

This test generates declarations, bundles/minifies a component/helper library,
packs it with `bun pm pack`, installs the tarball into an isolated consumer,
and deletes the producer directory before checking the consumer. Consumer
typechecking uses `bun check`. It exercises named barrels, a public subpath,
SSR, development dependency optimization, production builds, and unused-export
tree shaking. With Chrome available (`MMD_CHROME_PATH` or a detected local
installation), it also tests events, request-state subscriptions, retained input
drafts, slot fallback/projection, and conditional removal/remounting in both
development and production.
The request-state helper and its payload share one JSX conditional, exercising
initial absence and refresh without requiring separate rendering sinks.

The framework dependencies in that fixture use the matching built checkout;
the library under test is a real installed tarball with no source alias. This
is not yet a registry-release or cross-version runtime compatibility test.
SSR regression coverage separately verifies that external library/runtime
module copies share the active request scope without resetting concurrent
requests when another server entry loads. That does not make incompatible
runtime versions interchangeable.

In a monorepo, build ordering matters: build the compiler before packages which
generate artifacts. The root Memoized DOM build does this for
`@memoized-dom/utils`.

The repository's `bun run bench:package-compilation` command compares compiling
package source with linking an already generated artifact. It is a compiler
microbenchmark, not a promise about a complete Vite build.

## Opaque runtime boundaries

Package compilation can compose relationships through local helpers and other
package artifacts. It cannot infer behavior hidden inside source it cannot see.
For example, a runtime function which stores request-holder identity without
reading its payload needs a summary saying so:

```ts
import { definePackageBoundaries } from '@memoized-dom/compiler';

const dependencyArtifact = definePackageBoundaries({
  'runtime-package/internal': {
    holdSource: {
      source: [0],
    },
  },
});

experimentalCompilePackage(modules, {
  experimentalPackageArtifacts: [dependencyArtifact],
  packageEntries: { 'my-package': './index.ts' },
});
```

This is dependency information at the opaque boundary, not a special case for
the public helper. `@memoized-dom/utils` uses this mechanism for
`protectLiveSources`; the resulting public `optimistic` summary is inferred as
`options.source` holder usage. A nested argument path can be written as
`{ argument: 0, path: ['source'] }`. Package authors do not write the complete
versioned artifact shape: `experimentalCompilePackage` generates it from source,
and this builder fills the format details only for behavior hidden from the
compiler.

## Runtime-owned module state

Portable summaries normally reject helpers which capture module state because
that state cannot be joined to the consuming application's reactive graph. A
package may opt in when the state is entirely managed by its emitted JavaScript:

```ts
packageEntries: {
  'my-package': {
    moduleId: './index.ts',
    exports: ['myHelper'],
    runtimeOwnedState: true,
  },
}
```

This is an assertion by the package author, not an automatic escape hatch. Use
it for implementation state such as caches, deduplication maps, or registries
whose lifecycle and updates are handled by package runtime code. Do not use it
when UI reactivity depends on the application compiler observing that captured
state; the artifact intentionally omits it.

## Precompiled components

Components are compiled in the package and linked into the consuming component
graph through the artifact. The application compiler still owns each call site:
it validates props, builds slot callbacks, assigns runtime IDs, pushes changed
props, and places the component in the application tree. Package source is not
admitted into the application graph.

Packaged components currently expose the ordinary component factory ABI. They
work as rows in application-owned keyed lists, but do not advertise the
caller-specific lightweight row ABI; preserving correctness across the package
boundary takes precedence over that allocation optimization.

```tsx
export function Badge({ value }: { value: number }) {
  let localClicks = 0;
  return <button onClick={() => localClicks++}>{value}:{localClicks}</button>;
}

export function Panel() {
  return <section><slot><p>Fallback</p></slot></section>;
}
```

Component-local state is supported because each factory instance owns it.
Scalar props should be typed so their scalar mode is fixed during package
compilation. Explicit `<slot>` declarations fix projected JSX content. An
untyped interpolation such as `{value}` may deliberately become a render prop;
the artifact preserves that decision, and the consumer receives a compile error
if it passes a scalar. Passing JSX to a packaged scalar prop is also rejected.

The current component boundary rejects:

- reads or writes of reactive package module state;
- routed preparation owned by the package component;
- application-dependent package state exports.

Local interaction, parent-driven prop updates, explicit slots, nested package
components, retained keyed lists, client rendering, and server rendering have
end-to-end regressions. Forwarded DOM refs are also carried by the component
contract. Package components remain external ESM modules, so the artifact does
not flatten them into the application bundle or erase the bundler's chunk
boundary.

Package compilation automatically emits a small initial render template when a
component has one closed host root made from static platform DOM, direct scalar
prop reads, and compiler slots with portable fallback content. The template is
data, not executable code or serialized source. At application compilation the
consumer's initial prop and slot values are substituted into the ordinary
initial-content planner.

A wholly static call retains its HTML and omits the browser factory call.
Components in this subset without slots also receive a generated host-relative
binding program. A reactive call can therefore retain the same initial HTML:

```tsx
// Published package source, compiled once by its author.
export function Badge({ label }: { label: string }) {
  return <strong title={label}>{label}</strong>;
}

// Consuming application.
import { Badge } from 'my-ui';
export function App() {
  let label = 'Ready';
  return <main><Badge label={label} /><button onClick={() => label = 'Done'}>Change</button></main>;
}
```

On initial delivery, the application emits `Ready` as HTML. The package factory
binds that existing host and its text once; later prop updates target those
nodes. Conditional remounts use the same factory's creation path. Application
compilation needs only the generated artifact and the published JavaScript.

The generated template declares `adoption: 'host-v1'` only when the matching
factory contains this optional host-binding path. Authors do not write this
field or pass a host themselves. The application linker supplies it through the
compiled call contract. Earlier artifacts without this capability continue to
use static specialization or ordinary creation.

### Binding package slots

A package component can also retain initial HTML when each slot is the sole
content of its own host and has no fallback:

```tsx
// Package source, compiled once.
export function Panel({ title }: { title: string }) {
  return <section>
    <h2>{title}</h2>
    <header><slot name="heading" /></header>
    <main><slot /></main>
  </section>;
}

// Application source. No special mounting or hydration API.
import { Panel } from 'my-ui';
export function App() {
  let count = 1;
  return <div><Panel title={'Count ' + count}>
    <button slot="heading" onClick={() => count++}>Increment</button>
    <p>{count}</p>
    <input placeholder="Your draft" />
  </Panel></div>;
}
```

The package binds its section, heading and slot hosts. The application binds
projected content inside those hosts, so its state, events and update closures
remain owned by the caller. Updating `count` does not rerun either component
body or recreate the input. Conditional removal and remounting use the normal
creation and cleanup paths. Separate instances can receive different content
widths or omit slots; supported caller-owned lists and conditional content keep
their normal binding behavior.

The compiler generates `adoption: 'host-slots-v1'` for this bounded contract.
There is no extra author configuration or handwritten slot address metadata.
Its dedicated hosts keep package-owned addresses independent of the projected
content's width. The newer generated `host-slots-v2` capability extends this to
fallback content and element-separated siblings, described below. These are
initial-delivery optimization boundaries, not restrictions on authoring or
rendering package slots in general.

Components with refs, effects, setup statements, nested components, or dynamic
structure still continue through ordinary creation.
General runtime SSR and its existing hydration path remain available for those
broader components.

### Binding package-owned events

A package component with the same closed DOM shape may also own event handlers:

```tsx
// Package source, compiled once.
export function Button({ label, onPress }: {
  label: string;
  onPress: () => void;
}) {
  return <button onClick={onPress}>{label}</button>;
}

// Consuming application.
import { Button } from 'my-ui';
export function App() {
  let count = 0;
  return <main>
    <Button label="Increment" onPress={() => count++} />
    <output>{count}</output>
  </main>;
}
```

The initial button arrives as HTML. The package factory binds that existing
button and attaches its handler once; the application's callback keeps its
normal lexical state and invalidation behavior. Later prop changes update the
existing bindings, not the component body. Handler wrappers inside the package
and input events use the same path. Package-owned events can be combined with
caller-owned slot content and the portable fallbacks described below.

If a package component handler needs conservative invalidation for an opaque
callback, it resolves the root through its mounted runtime owner. It does not
assume the consuming root is named `App`. This applies to both existing-HTML
binding and ordinary creation and stays inside the active application runtime.
Shared module handlers without a lexical component owner conservatively
invalidate that active runtime; they cannot target a different request's runtime.

Even a component with no props, or with only constant props, must retain its
factory when it attaches a handler. The compiler-generated `host-events-v1`
capability records that requirement. Older compilers reject this capability
rather than silently treating the component as inert static HTML. Authors do
not write that metadata, and handlers never execute while generating HTML.
Use compatible compiler and runtime builds when generating and consuming these
experimental packages; their emitted factories still use the runtime's internal
component and invalidation ABI.

This extends initial binding for components whose body is a direct JSX return.
It does not yet add initial binding for package-local setup/state, effects,
refs or dynamic structure. Those components
still work through ordinary creation and the existing runtime SSR/hydration
path. If an event-bearing shape cannot safely bind, the compiler keeps that
whole component on ordinary creation rather than emitting inactive controls.

Fullstack SSR remains independent and can render broader package components by
executing their emitted server factories. Package compilation never executes an
arbitrary package factory during a build and never admits the package AST into
the consuming application as a shortcut.

### Slot fallbacks and surrounding package content

```tsx
export function Panel({ title, onPress }: {
  title: string;
  onPress: () => void;
}) {
  return <section>
    <b>Before</b>
    <slot><button onClick={onPress}>{title}</button></slot>
    <strong>{title}</strong>
  </section>;
}
```

The package build generates `host-slots-v2` automatically. The fallback has its
own package-owned binding plan; supplied content retains the caller's lexical
ownership. One mounted instance can omit content while another supplies several
nodes. Reactive text, attributes and handlers bind the original elements in
either case, including the package's siblings after the slot. Local input drafts
survive updates. Conditional removal disposes the old mount; showing it again
creates a fresh mount through the existing factory. No component-body rerun,
extra wrapper element, or new hydration mechanism is introduced.

An omitted slot uses its fallback. Explicitly supplied empty content, such as
`<Panel title="Title" onPress={save}>{null}</Panel>`, intentionally renders no
fallback. Entirely static content can still become HTML without browser code;
fallback handlers retain the factory even when all props are constant.

This contract permits one slot per parent, with immediate siblings that are
elements rather than text. Named and default slots can coexist in separate
hosts. Direct text adjacency (`Before<slot />After`), multiple slots
in the same parent, and slots nested inside fallback content do not receive this
capability. They retain static specialization where proven or ordinary creation.
The compiler validates these boundaries rather than assigning unsafe addresses.
Authors do not write slot sites or capability metadata; publish the generated
JavaScript and matching artifact together.

## Current boundaries

- Named imports are supported; namespace imports do not identify one semantic
  export and are not linked.
- Exported compiler-owned package state is not supported. Components are limited
  to the precompiled boundary described above.
- Entry matching is exact; metadata for `my-package` does not automatically
  describe `my-package/subpath`.
- The package build must regenerate the artifact whenever helper behavior
  changes. Vite watches the file but cannot repair stale published metadata.
- In development, Vite treats the package manifest and semantic artifact as
  graph inputs. A changed artifact recompiles its consuming graph; an invalid
  edit reaches the normal error overlay, and repairing it resumes HMR without a
  forced page reload. JavaScript implementation updates still use Vite's normal
  package-module invalidation path.
- The artifact and executable JavaScript must come from the same package
  compilation. Artifact/source integrity hashes are not implemented yet.
- The semantic digest identifies artifact contents; it is not yet an integrity
  proof that published JavaScript was built from the same source. Package builds
  must still publish compiler output and its matching artifact together.
- Package initial HTML and host adoption cover the subsets described above.
  Text-adjacent or multiple same-parent slots, nested fallback slots, and
  package-local setup/state, refs or effects are outside the portable
  initial-binding contract.
- Array literals passed to a holder relationship preserve every contained
  holder. Arbitrarily assembled dynamic collections are not yet a portable
  holder contract.

The implementation rationale and remaining component work are recorded in
[Separate package compilation and reactive linking](./package-compilation-research.md).
