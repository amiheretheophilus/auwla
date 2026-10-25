# Benchmarks

## On the benchmark VM: one command

From the repository root, with Git, Node (>= 24.11), Bun and Chrome or
Chromium installed:

```sh
git pull
bun install --frozen-lockfile
bun run bench:vm
```

`bench:vm` (`vm.ts`) builds the packages and runs, compiled by compiler-next:

1. the DOM suite: memoized-dom against vanilla JS, with component and inline
   rows, every state placement, and mutable/immutable updates (`dom/`);
2. the pinned Octane suite: memoized-dom against nine frameworks (`octane/`).
   Its dependencies and Chromium are installed on first use.

Every report lands in one folder, `bench/results/<time>-<commit>-<compiler>/`,
with a summary in its `README.md`. Send that folder back. The run leaves the
checkout clean, so the next `git pull` works.

| Command | What it does |
|---|---|
| `bun run bench:vm` | everything, timed |
| `bun run bench:vm --quick` | correctness gates only, and one Octane sample: a check that it all runs |
| `bun run bench:vm --only=dom` | only the DOM suite (or `--only=octane`) |
| `bun run bench:vm --before-ref=d6e678b` | also time the baseline commit side by side (DOM ABBA comparison and Octane before/after columns) |
| `bun run bench:vm --compiler=old` | the same with the existing compiler, for reference |
| `bun run bench:vm --no-build` | skip `bun run build` |

The same command runs on a GitHub runner, started by hand
(`.github/workflows/bench.yml`; its inputs mirror the options above):

```sh
gh workflow run bench.yml --repo amiheretheophilus/auwla --ref compiler-rewrite -f mode=full -f only=all -f compiler=next
gh run download <id> --repo amiheretheophilus/auwla -n bench-results
```

A shared runner is noisier than the VM: compare columns within one run, not
numbers across runs. The run's summary page shows the results table.

Each compiler's output stays separate, so both can be read and run:

| | Existing compiler | compiler-next |
|---|---|---|
| DOM apps | `dom/compiled-*.ts` | `dom/compiled-*.next.ts` |
| DOM update styles | `dom/dist/update-style/*.ts` | `dom/dist/update-style/*.next.ts` |
| DOM timings | `dom/state-placement-results.md` | `dom/state-placement-results.next.md` |
| Octane app | `octane/memoized-dom/dist/` | `octane/memoized-dom/dist.next/` |

The individual scripts below select compiler-next with `BENCH_COMPILER=next`
(for example `BENCH_COMPILER=next bun run bench`); without it they use the
existing compiler, as before.

`bun run bench:size:html` builds stable authored fixtures through the production
Vite HTML pipeline and reports HTML, all emitted JavaScript and separately
compressed sizes in `bench/package-size/dist/html/results.{json,md}`. Static
and larger composed static pages must emit zero JS assets. Interactive fixtures
remain alongside them so static pruning cannot hide the current runtime cost.
The mixed fixtures compare one and sixty static cards around the same counter,
including the ordinary JS-entry DOM-creation build of each authored graph.
The direct binding fixtures repeat this comparison for a host root with local
events and state, including initial counter HTML and growing static content.
Counter fixtures also record the ordinary DOM-creation target. Binding-helper
overhead and the existing interactive runtime are included in the measurements.

Each benchmark is a self-contained suite with its runner, sources, methodology,
latest measurements, limits, and interpretation.

| Suite | Command | Measures |
|---|---|---|
| [`dom`](./dom/) | `bun run bench` | End-to-end list operations in real Chromium |
| [`effects`](./effects/) | `bun run bench:effects` | Production receiver-bounded versus root invalidation |
| [`invalidation`](./invalidation/) | `bun run bench:invalidation` | Dirty-reason mask update-evaluation prototype |
| [`linker`](./linker/) | `bun run bench:linker` | Cross-module compiler/linker throughput |
| [`lifecycle`](./lifecycle/) | `bun run bench:lifecycle` | Production cleanup ownership and entity teardown |
| [`children`](./children/) | `bun run bench:children` | Production component children mount/update overhead |
| [`components`](./components/) | `bun run bench:components` | Same-file versus linked component runtime/compiler cost |
| [`local-state`](./local-state/) | `bun run bench:local-state` | Module versus instance collection row ownership |
| [`local-derived`](./local-derived/) | `bun run bench:local-derived` | Dependency-selected component-local derivation replay |
| [`jsx`](./jsx/) | `bun run bench:jsx` | Specialized versus ordered-spread authored JSX paths |
| [`router`](./router/) | `bun run bench:router` | Cached, warm-varied, construction, and runtime routing paths |
| [`package-size`](./package-size/) | `bun run bench:size` | Built package and real todo browser bundle size |
| [`frameworks`](./frameworks/) | `bun run bench:frameworks` | Current framework update-completion scenarios |
| [`octane`](./octane/) | `bun run bench:octane` | Pinned upstream js-framework and keyed-reorder suites, including memoized-dom |
| [`application`](./frameworks/application/) | `bun run bench:application` | Structured cross-framework application workflows |

Numbers are machine-local and must be compared using repeated processes on the
same machine. A mechanism-level benchmark is not evidence of end-to-end
application improvement; each suite README states what is excluded.

The DOM suite owns generated files under `dom/dist/`. Its `build.ts` also
refreshes the tracked compiled component and inline-row sources before each run.
