# Compiling ordinary third-party JavaScript

This is an integration experiment, not yet an automatic dependency-compilation
option in the application Vite plugin. Normal imports still work as opaque
JavaScript; opaque execution alone does not establish every reactive relationship.

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

## Intended consumer workflow

An application should explicitly opt a dependency into compilation once, then
continue using its normal imports. The exact public configuration is not yet
implemented or settled. This is **not** another library-author build script,
manual artifact object, per-function list, or required wrapper package.

The build tool would own this pipeline:

1. Resolve the selected installed package from the actual importer, respecting
   its ESM export conditions, public subpaths and multiple installed copies.
2. Collect the relevant implementation graph without executing the package.
3. Analyze and, when needed, transform it using the package compiler.
4. Store emitted JavaScript and finalized metadata in a separate generated cache.
5. Link each application import to the matching compiled copy and its metadata.

The original `node_modules` stays unchanged. Cache identity must include the
resolved implementation bytes, relevant dependency resolutions, compiler
contract/options and target conditions—not just the package name or npm version.
Development invalidation, production bundling, SSR and runtime ABI checks must
agree on the same implementation. Existing declarations should remain attached
to the original public imports; compilation is not a new type-authoring burden.

For example, a possible application-level opt-in is
`memoizedDom({ compilePackages: ['dset'] })` in the existing Vite configuration.
This spelling is a proposal, **not an available option yet**. The list selects
packages, not fifty individual helpers or implementation files. Imports such as
`import { dset } from 'dset/merge'` would remain unchanged.

Libraries authored for Memoized DOM continue to use `.lib.config.ts` and
`memoized-dom package`. Consuming an already published compiler-aware package
still requires no opt-in or recompile.

## What this experiment does not prove

dset and throttle-debounce cover synchronous argument writes and private
timer/callback closures, respectively. Neither has a dependency graph or an
external reactive store protocol. Passing these integrations is not proof that
arbitrary npm packages can be transformed.
CommonJS conversion, conditional browser/server implementations, dependency
graphs and persistent caches still need dedicated integration coverage before a
public installed-package option is introduced. The library command's authored
entry/declaration rules have not been expanded to arbitrary installed `.mjs`
packages by this experiment.

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
