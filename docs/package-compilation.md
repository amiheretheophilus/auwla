# Packaging compiler-aware helpers

Memoized DOM packages may ship a small semantic artifact beside their ordinary
JavaScript and declarations. The artifact lets the application compiler retain
reactive relationships hidden behind a package import without recognizing the
package or helper by name.

This API is experimental. It currently supports ordinary named functions only;
package components and exported compiler-owned state are not portable yet.

## What package consumers do

Nothing beyond a normal import:

```ts
import { pending, optimistic } from '@memoized-dom/utils';
```

The Memoized DOM Vite plugin resolves that bare import, finds the package
manifest, loads its artifact, and watches both files during development. The
artifact is compiler metadata, not executable code, and does not add a runtime
import.

Hosts which call `compileModules` or `compileModulesDetailed` directly do not
perform filesystem discovery. They must read the artifact and pass it through
`experimentalPackageArtifacts` themselves.

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

const { artifact } = experimentalCompilePackage(modules, {
  packageEntries: {
    'my-package': {
      moduleId: './index.ts',
      exports: ['pending', 'status'],
    },
  },
});

await writeFile(
  new URL('../dist/memoized-dom.package.json', import.meta.url),
  `${JSON.stringify(artifact, null, 2)}\n`,
);
```

`exports` is recommended when the public entry also exposes values or types
which are not compiler-aware helpers. Every selected name must resolve to an
ordinary named function export. The generated JavaScript remains the package's
normal JavaScript; consumers still load it through the bundler.

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
import type { ExperimentalPackageArtifact } from '@memoized-dom/compiler';

const dependencyArtifact: ExperimentalPackageArtifact = {
  kind: 'memoized-dom-package',
  version: 1,
  entries: {
    'runtime-package/internal': {
      functions: {
        holdSource: {
          parameterWrites: [],
          parameterSourceReads: [{ index: 0, path: [] }],
          parameterPayloadReads: [],
          unbounded: false,
        },
      },
    },
  },
};

experimentalCompilePackage(modules, {
  experimentalPackageArtifacts: [dependencyArtifact],
  packageEntries: { 'my-package': './index.ts' },
});
```

This is dependency information at the opaque boundary, not a special case for
the public helper. `@memoized-dom/utils` uses this mechanism for
`protectLiveSources`; the resulting public `optimistic` summary is inferred as
`options.source` holder usage.

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

## Current boundaries

- Named imports are supported; namespace imports do not identify one semantic
  export and are not linked.
- Package components and exported compiler-owned state are not supported.
- Entry matching is exact; metadata for `my-package` does not automatically
  describe `my-package/subpath`.
- The package build must regenerate the artifact whenever helper behavior
  changes. Vite watches the file but cannot repair stale published metadata.
- Array literals passed to a holder relationship preserve every contained
  holder. Arbitrarily assembled dynamic collections are not yet a portable
  holder contract.

The implementation rationale and future component work are recorded in
[Separate package compilation and reactive linking](./package-compilation-research.md).
