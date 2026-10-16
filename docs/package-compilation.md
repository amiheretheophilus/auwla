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

The static initial-content planner currently treats a packaged component as a
browser-owned boundary because its body is deliberately absent from the
application graph. Fullstack SSR can still render it through the emitted server
factory, but a browser-only build cannot yet turn that package subtree into the
compiler's zero/low-JavaScript initial HTML. Preserving that optimization needs
a portable deferred render plan parameterized by consumer props and slots. The
compiler must not execute arbitrary package code at build time or smuggle the
package AST back into each application as a shortcut.

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
- Packaged components do not yet participate in static initial-content
  specialization; they use ordinary browser creation or runtime SSR.
- Array literals passed to a holder relationship preserve every contained
  holder. Arbitrarily assembled dynamic collections are not yet a portable
  holder contract.

The implementation rationale and remaining component work are recorded in
[Separate package compilation and reactive linking](./package-compilation-research.md).
