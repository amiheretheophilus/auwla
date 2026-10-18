# Compiling ordinary third-party JavaScript

The Vite plugin offers experimental, opt-in compilation of installed ESM
packages. Normal imports still work as opaque JavaScript without the option;
opaque execution alone does not establish every reactive relationship.

## First real package: dset

The regression compiles the **published, unchanged ESM implementation of dset
3.1.4**, including `dset/merge`. Source snapshots retain the upstream MIT license,
release provenance and verified SHA-256 hashes. Tests run offline. There are no
dset-specific compiler branches or manually authored write summaries.

```tsx
import { dset } from 'dset';

// After compilation/linking, the argument-write summary connects this mutation
// to the application's readers; authors do not notify the UI themselves.
dset(model, 'profile.name', 'Ada');
```

The package compiler produces its normal JavaScript plus semantic metadata. The
application compiler receives that metadata and compiles only application code;
it does not need to inline or reanalyze dset's implementation at every call site.
The regression installs generated output into its own isolated fixture directory,
never overwriting the original dependency. Integrity finalization binds the
emitted JavaScript and metadata together.

Covered behavior:

- Deep writes update a separately compiled sibling component and derived reads.
- Named aliases, application re-exports and the `/merge` subpath retain effects.
- String and array paths work; existing DOM nodes and input drafts survive.
- Summarized helpers can mutate resolved `$fetch` payloads and notify the owning
  resource without another request. This applies to ordinary source helpers too.
- Compiled functions retain upstream mutation results and prototype guards.
- The emitted dependency also runs during server rendering.

The experiment exposed two general gaps: the default parser router did not
accept `.mjs`, and helper parameter writes did not publish local colorless-source
notifications. Both are addressed through general compiler paths, not package
name recognition.

## Second real package: retained callbacks and cancellation

The next regression compiles the **published, unchanged ESM implementation of
throttle-debounce 5.0.2**. Its timer, cancellation flag and callback closure stay
private to each returned function. The offline fixture retains both upstream
MIT notices and pins source hashes verified against the official npm tarball.
No debounce/throttle names or callback contracts are hard-coded in the compiler.

The application keeps ordinary authoring:

```tsx
import { debounce } from 'throttle-debounce';

export function Search() {
  let query = '';
  const update = debounce(150, async (value: string) => {
    await Promise.resolve();
    query = value;
  });
  $cleanup(() => update.cancel());

  return <section>
    <input onInput={event => update(event.currentTarget.value)} />
    <output>{query}</output>
  </section>;
}
```

Both opaque and compiled execution are tested. Callback writes already use
ordinary application callback lowering; package compilation is not required to
make a debounce callback reactive. This is a compatibility check, not a speedup
claim. A timer returning does not commit an async callback early: writes after
`await` publish when that callback completes.

The experiment found a general cross-module gap: an application function passed
directly from another module could execute later without publishing its writes.
The linker now recognizes escaped callback imports and instruments their original
application declarations. Aliases, re-exports, static namespace imports and
immutable local aliases retain that relationship; shadowed names and ordinary
direct calls are not mistaken for escaping callbacks. This preserves the original
function identity, arguments, receiver and return behavior instead of inserting
a package-specific wrapper.

Coverage includes:

- Latest-argument delivery, named and inline callbacks, and post-`await` writes.
- A separately compiled sibling observing a delayed module-state mutation.
- Delayed writes to a resolved `$fetch` payload without another request.
- Retained DOM nodes, input drafts and independent component-local closures.
- Upcoming-only and permanent cancellation, disposal before the timer fires,
  and a remounted component receiving fresh state.
- Real Chromium with minified production runtime output, in both modes, checking
  that updates do not rerun component setup or replace unrelated DOM.

Cancellation is still explicit. `$cleanup(() => update.cancel())` connects the
package's existing cancellation API to the component's lifetime. Compiling a
package does not invent disposal, stop an already-running async operation, or
turn an arbitrary external store into a subscribed reactive source. Pass an
appropriate cancellation mechanism to in-flight work when the application needs
that guarantee.

After building, run:

```sh
bun test --isolate ./tests/third-party-callback-compilation.test.ts ./tests/linked-retained-callbacks.test.ts
```

The timer tests use a deterministic clock. Production-browser tests use real
timers and require Chrome/Chromium; set `MMD_CHROME_PATH` if it is not discovered.
They are explicitly skipped when no browser is available.

## Consumer workflow: compile an installed dependency

Add the package name to the **existing application Vite configuration**. No
`.lib.config.ts`, package.json changes, wrapper package or manual artifact script
is needed for an ordinary third-party dependency:

```ts
import { defineConfig } from 'vite';
import { memoizedDom } from '@memoized-dom/vite';

export default defineConfig({
  plugins: [memoizedDom({
    clientEntry: './src/main.ts',
    compilePackages: ['dset', 'throttle-debounce'],
  })],
});
```

Keep ordinary imports, including supported public subpaths:

```ts
import { dset } from 'dset';
import { dset as mergePath } from 'dset/merge';
import { debounce } from 'throttle-debounce';
```

The list selects packages, not individual exports or subpaths. Scoped names such
as `@scope/package` work too. JSON, CSS and other non-JavaScript subpaths keep
their ordinary Vite loaders. The plugin excludes opted-in packages from Vite's
dependency optimizer and prevents their SSR externalization so browser/server
resolution, executable code and compiler metadata stay aligned. Existing type
declarations remain attached to the original imports.

The build tool owns this pipeline:

1. Resolve the selected installed package from the actual importer, respecting
   its ESM export conditions, explicit public subpaths and multiple installed copies.
2. Collect the relevant implementation graph without executing the package.
3. Analyze and, when needed, transform it using the package compiler.
4. Store emitted JavaScript and finalized metadata in a separate generated cache.
5. Link each application import to the matching compiled copy and its metadata.

The installed package's files and manifest remain unchanged. Output lives under
`<vite cacheDir>/memoized-dom-packages/<content-key>/`, normally inside
`node_modules/.vite`. This is generated cache storage, not a modified dependency.
Warm builds reuse verified emitted code and metadata; they still inspect inputs
and resolutions to establish that the cache matches. They do not skip all build
work. Publication is atomic, and concurrent requests for the same key coalesce.

To measure that actual consumer pipeline, run
`bun run bench:installed-packages --smoke` to verify the harness, then
`bun run bench:installed-packages --samples 7` for measurements. It compares
opaque and opted-in production builds in fresh Node processes, asserts persistent
cache reuse and source-edit invalidation, and records build/process timings plus
raw/gzip JavaScript sizes. This is separate from the runtime benchmark; see
[methodology and limits](../bench/installed-packages/README.md).

Cache identity includes source/manifest bytes, local implementation resolutions,
external dependency/artifact resolutions, compiler implementation and direct
dependency fingerprints, runtime resolution, compiler options and Vite environment
conditions. Browser and server outputs are separate. Runtime ABI declarations
are checked at the original resolution locations. Changed or corrupted cached
JavaScript is rejected instead of silently running with stale metadata; clear
the Vite dependency cache and restart to rebuild it.

Explicit public ESM subpaths are compiled together so their shared implementation
modules keep one module identity. Package-private callback/timer closures are
still ordinary per-call JavaScript closures. Other packages remain external:
their original importer-relative copy is preserved. If their effects need linking,
they must already ship compiler metadata or also be listed in `compilePackages`.
The plugin does not recursively transform every transitive npm dependency without
an opt-in.

During development, original implementation files, manifests and metadata are
watched, including bounded native watches for selected dependencies that Vite
otherwise ignores in `node_modules`. A changed implementation gets a new cache
key and invalidates its managed application importers. Generated cache files are
not watched as source and are not compiled a second time. Normal application HMR
still decides whether an update can retain state or needs a reload.

Libraries authored for Memoized DOM continue to use `.lib.config.ts` and
`memoized-dom package`. Consuming an already published compiler-aware package
still requires no opt-in or recompile.

A publisher's existing artifact takes precedence even if its package appears in
`compilePackages`. Its integrity/compatibility failures remain errors; the plugin
does not bypass them by recompiling the package.

### Current boundaries

This option is experimental and deliberately bounded:

- ESM `.mjs`, or `.js`/`.jsx` in a `type: module` scope. Public JSX must fit the
  existing Memoized DOM component contract; React components are not converted.
- Root entries and explicit JavaScript subpaths in `exports`. Wildcard exports
  and legacy deep imports without an explicit exports map are not supported yet.
- Static local imports/re-exports, including `export *`, are collected without
  executing package code. Dynamic imports and `import.meta` are rejected because
  relocating them safely needs a separate module-identity contract.
- CommonJS conversion, exported/captured compiler-owned module state, unknown
  required effects, external-store subscription inference and custom frontends
  are not supported. These produce diagnostics, not a silent compiled claim.
- At most 256 public JavaScript entries, 512 implementation modules and 8 MiB
  implementation source per package; opted-in cross-package cycles and chains
  deeper than 32 are rejected.

Remove a package from the opt-in list to use its original opaque path. That does
not remove the need to integrate an external store's notification protocol or
manage callbacks with the package's own cleanup API.

## What this experiment does not prove

dset and throttle-debounce cover synchronous argument writes and private
timer/callback closures, respectively. Neither has a dependency graph or an
external reactive store protocol. Passing these integrations is not proof that
arbitrary npm packages can be transformed.
The installed-package integration now has coverage for conditional browser/server
implementations, static helper graphs, multiple copies, opted-in dependencies,
persistent cache hits/invalidation, corrupted output, runtime ABI checks and
node_modules edits. Those bounded cases do not imply universal npm compatibility.
The library command's authored entry/declaration rules are separate from this
consumer-side option.

Dynamic property writes are conservatively summarized at the argument root.
The compiler does not recover an exact runtime path from a string such as
`'profile.name'`; summaries can also over-approximate other argument writes.
Correct notifications are the first goal, not a claim of perfect precision.

Compiling a debounce implementation does not automatically supply a safe lifetime
for its retained callbacks. Compiling an external store does not invent its
notification protocol. Another framework's components do not become Memoized DOM
components merely because their JavaScript parses. Unsupported required effects
must be diagnosed or explicitly integrated, never silently advertised as native.

Run the experiment after building the workspace:

```sh
bun test --isolate ./tests/third-party-package-compilation.test.ts
```

## Runtime measurements

Use `bun run bench:third-party-runtime --smoke` to validate the benchmark setup,
then `bun run bench:third-party-runtime` for the full opaque/compiled comparison.
It measures idle-frame work separately from click throughput in real Chromium,
verifies correctness in both modes, and saves raw samples plus machine metadata.
See [benchmark instructions and interpretation](../bench/third-party-runtime/README.md).
Do not infer a speedup merely from a removed volatile flag or from smoke timings.

See [library packaging](./library-packaging.md) for the completed authoring flow
and [package compilation research](./package-compilation-research.md) for the
broader integration boundaries.
