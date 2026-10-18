# Opaque vs compiled third-party JavaScript: runtime benchmark

This measures the optional runtime benefit of compiling unchanged **dset 3.1.4**,
not whether an opaque package can work. Both modes must render correct results.
It uses real headless Chromium and the **production runtime**, not Happy DOM or
the testing entry. No benchmark-specific compiler rules are installed.

## Run from a fresh checkout

```sh
git clone --branch codex/package-conditional-sync https://github.com/snrraptopack/memo-exp.git
cd memo-exp
bun install
bun run build
bun run bench:third-party-runtime --smoke
bun run bench:third-party-runtime
```

The smoke run checks the whole browser/build/report pipeline with small workloads;
**do not treat its timing numbers as performance evidence**. The full defaults
are 1, 32 and 128 mounted instances, 7 samples after 2 warm-ups, 120 idle frames
and 100 mutations per measured batch. Progress is printed per scenario/size.
Build/setup can take longer than the measured batches, particularly on older PCs.

Chrome/Chromium must be installed. Chrome on common Windows/macOS/Linux paths
and Edge on its common Windows path are detected automatically. Otherwise:

```powershell
$env:MMD_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
bun run bench:third-party-runtime
```

Or pass `--chrome /absolute/path/to/chromium`. The runner launches its own headless
browser/profile; it does not use your personal browser session or download one.

For a longer run, use the **same settings on every machine**:

```sh
bun run bench:third-party-runtime --samples 11 --sizes 1,64,256 --operations 300 --frames 300 --warmups 3
```

Other options: `--output path/to/report.json`, `--help`. Existing report files
are never overwritten. Use a new output name for each run. Timings are printed
in microseconds per unit; smaller is better. Tiny values near timer resolution
and overlapping interquartile ranges are not reliable speedup claims.

## What is measured

Each case has identical authored app source, normal `import {dset} from 'dset'`,
and an isolated runtime. Opaque mode executes the original ESM with no semantic
artifact. Compiled mode executes the package compiler's output and links its
inferred artifact. The upstream fixture hashes are checked before building.
Bundling is minified, HMR is off, and runtime instrumentation is not enabled.

| Scenario | Data being changed |
| --- | --- |
| `local` | One object owned by each mounted component. |
| `shared` | Module-owned objects read by separate sibling readers. |
| `fetch` | Resolved `$fetch` payloads; one initial in-memory request per instance. |

The fake backend returns an initial JSON response immediately. **No network
latency, live transport, SSE or database cost is measured.** Setup waits until
every initial value is visible; data delivery is excluded from timing. A real
browser app runtime remains active for the full trial, including asynchronous
initial data settlement.

Three independent phases:

- `idle`: pump a fixed number of simulated visible frames with no mutations.
- `updates`: dispatch DOM clicks round-robin across instances and complete their
  synchronous commits, without pumping a frame between clicks.
- `updates-frame`: dispatch one click followed by one simulated frame per unit.

The frame driver snapshots pending callbacks before executing them, so a callback
which schedules the next frame cannot loop forever in the same frame. Compiled
cases with no volatile work still pay the common empty-driver overhead. Tabs are
brought to the foreground; hidden tabs, where opaque pulling is skipped, are
rejected. Cross-origin isolation enables higher-resolution timers where supported.

The frame count is deterministic. This is **not** a measurement of operating
system idle CPU%, battery usage, real RAF cadence, FPS, paint, layout or input
latency. It measures JavaScript/DOM processing under a controlled driver. A click
batch without frames is a throughput microbenchmark, not a realistic user burst.

Both modes are warmed up. Sample order alternates between opaque-first and
compiled-first. Mounting, teardown, DOM readiness, output verification and
diagnostic instrumentation are all outside the timed regions. Browser GC/JIT and
machine load can still affect results; raw samples are retained rather than hidden.

## Correctness and diagnostics

Every timing trial fails on stale/wrong values, replaced output nodes, lost input
drafts or an unexpected refetch. Before timing, a separate diagnostic run records:

- registered and volatile entity counts;
- callbacks and entity renders across **5 simulated idle frames**;
- renders and guarded text writes across **one increment per instance**, with a
  frame after each increment;
- initial request count.

Idle text writes must be zero. Each diagnostic increment must produce exactly one
guarded text write. The diagnostic render wrappers and text-setter counter are
removed before timing, so they do not inflate a mode's measured cost. Diagnostics
explain *why* a result differs without assuming compilation always wins.

The shared-state fixture uses direct module-array reads. Other shapes, including
some derived sibling reads from the earlier control experiment, can retain a
volatile reader even after compilation. This benchmark does not prove that all
shared-state fallback checks disappear.

## Send back the report

The runner saves a timestamped JSON file under `bench/third-party-runtime/results/`
and prints its absolute path. Send that **whole JSON file**, not only a screenshot
of the median table. It includes every sample, median/P25/P75, diagnostics,
fixture/bundle information, git revision/dirty status, browser/Bun/OS versions,
CPU model, memory and run settings. Generated files/results are gitignored.

Run on mains power with a stable power mode, close unrelated heavy workloads,
and repeat the full command two or three times. Keep the browser version/settings
consistent when possible. Report unusual machine load or throttling separately.
Do not compare numbers from different commits as if they were the same experiment.

Package compilation and bundling happen before runtime timing. Their one-off
preparation timings and output sizes are recorded separately, not amortized into
runtime results or presented as rigorous cold-build benchmarks. Bundle sizes
include the harness and are not a production application size audit.
This harness exercises the compiler/linker pipeline directly; it does **not**
measure the Vite `compilePackages` option's collection or persistent cache.
That experimental consumer option is now available; see
[installed-package configuration and boundaries](../../docs/third-party-package-compilation.md#consumer-workflow-compile-an-installed-dependency).
The `throttle-debounce` regressions additionally cover retained callbacks,
asynchronous writes and cancellation. Neither fixture establishes universal
npm compatibility or a speedup for every package.
