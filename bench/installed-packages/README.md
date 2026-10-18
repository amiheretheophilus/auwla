# Installed-package compilation: real Vite build benchmark

This measures the application's `compilePackages` option through the **built,
published Vite plugin**, not direct calls to the compiler API. The same small
application imports the unchanged offline `dset@3.1.4` root and `/merge` subpath,
plus `throttle-debounce@5.0.2`, and uses synchronous writes, a retained async
callback and cleanup. Their upstream implementations live in
`tests/fixtures/third-party`; hashes are included in every report.

## Run

From the repository root:

```sh
bun install
bun run build
bun run bench:installed-packages --smoke
bun run bench:installed-packages --samples 7
```

Node must meet the repository's version requirement. No browser, network access,
third-party installation or application setup is needed. The smoke check performs
all six builds and cache assertions with one sample; it is **not performance
evidence**. Run actual measurements without other builds/tests or heavy workloads.

To choose the report location:

```sh
bun run bench:installed-packages --samples 7 --output installed-packages.json
```

Existing reports are never overwritten. Options are validated; unknown flags
fail. The default JSON report goes to the ignored `results/` folder. Send the
whole JSON file, including samples, rather than a screenshot of the table.

## What is measured

For each sample, two separate temporary applications use ordinary package imports:

- **Opaque:** no `compilePackages` option.
- **Compiled:** `compilePackages: ['dset', 'throttle-debounce']`.

Mode order alternates between samples. Each mode runs these phases in order:

1. **Cold:** a fresh project and empty generated package cache.
2. **Warm:** the same project/cache, but a fresh Node process, Vite instance and
   plugin. The benchmark asserts identical cache keys, file hashes and modification
   times: a successful second build alone does not prove reuse.
3. **Edited:** append a no-op comment to the fixture's installed dset source, then
   rebuild in another fresh Node process. The compiled path must add exactly one
   cache entry while preserving all previous immutable entries. The unrelated
   package must not be rebuilt. Opaque builds must never create package artifacts.

The no-op edit holds application semantics constant and isolates source-content
invalidation. It does **not** measure browser HMR latency or time to apply a changed
function. Those behaviors have separate integration regressions.

`buildMs` times the awaited Vite production client build, including collection,
compilation/cache verification and bundling. `processMs` additionally includes Node
startup/module loading and the post-build output/cache audit. Fixture preparation
and report writing are excluded. Cache verification still reads/hashes sources;
warm builds are not expected to do zero work.

The report retains every sample and median/P25/P75 for both timings and total
JavaScript bytes/gzip bytes. Gzip is computed **per emitted JS file and summed**;
HTML/assets are recorded separately in the raw output list, not included in JS
totals. All output hashes and per-entry cache file details are retained, along
with git revision/dirty status, Node/Bun/Vite versions, OS, CPU, memory and fixture
hashes. Reports made from different source revisions are not interchangeable.

## Boundaries

“Cold” means empty **generated package** cache, not a flushed OS disk cache, a new
machine or a clean dependency install. Earlier samples will warm the OS cache.
Vite/plugin/compiler imports happen before `buildMs`, but inside `processMs`.
There is no discarded warmup: cold and persistent-cache behavior are the things
being measured. Compare both timings and their spread; do not infer compiler-only
cost by subtracting two whole-build medians.

The small client fixture does not establish results for large npm packages, SSR,
dynamic imports, external reactive stores, every npm format or runtime speed.
It also does not audit lazy-route payloads or total production application size.
Use [the runtime benchmark](../third-party-runtime/README.md) for execution cost.
Neither benchmark promises that compiling a package is always faster or smaller.

Generated fixture projects live under `.generated/` so Node can resolve the
repository's built workspace dependencies. Only those newly created projects are
cleaned up; upstream fixture files and installed workspace packages are unchanged.
