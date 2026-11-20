# Navigation benchmark

What compiled route regions cost in a real browser: mounting an app with routes, navigating,
changing a path parameter, updating a prop of the page on screen, and changing only the query.

```sh
bun run bench:navigation                  # timed; report in dist/results.md
bun run bench:navigation --validate-only  # every operation checked, nothing timed
bun run bench:vm --only=navigation        # the same on the benchmark VM, into bench/results/
```

## Question

Does the route-regions pass (`packages/compiler/src/optimize/route-regions.ts`), which shows a
component's route region as one value slot instead of a three-branch conditional, cost or save
time anywhere? It changed bytes (Triaxis's `App` from 1,067 lines to 567); a size win that slows
navigation is a loss.

## Setup

- `app.tsx`: ten component routes, a route with a parameter, and state the app passes to every page.
- `build.ts` compiles it three ways, each bundled into its own page (each installs the same route
  table, so they cannot share one):
  - `optimized`: every pass, as an app is built;
  - `without-route-regions`: every pass but `route-regions` (`optimize: { skip: [...] }`), so the
    two pages differ by that pass alone;
  - `general`: no pass, the general path.
- `browser.ts` runs in the page. The router uses a **memory history**: browsers throttle the History
  API (about 200 calls in 10 seconds) and drop the rest, so thousands of navigations through it
  would time the throttle, and the address bar would fall behind the router.
- `run.ts` serves the pages on a local port (the bundle is an ES module: the compiled app prepares
  its first route with a top-level await), opens one fresh page per run, and runs the variants in a
  mirrored order, A B C C B A. Each cell is the median of 14 samples.

Every operation is checked outside the timing in `--validate-only`: one page on screen, its
heading, and the count the app passed down. Timed loops check the state each sample ends in. A
console error or warning fails the run.

## Scenarios

| Scenario | Operations per sample |
|---|---:|
| Mount and unmount the app on a page | 400 |
| Navigate between ten pages | 2,000 |
| Change a path parameter (`/posts/1` to `/posts/2`) | 2,000 |
| Update a prop of the page on screen | 5,000 |
| Change only the query | 2,000 |

## Browser

`PUPPETEER_EXECUTABLE_PATH` picks the browser, as for the DOM suite. `BENCH_BROWSER_URL` connects
to one already started with `--remote-debugging-port` instead (and leaves it running), which is
how it runs on a machine where Puppeteer cannot launch the browser itself. `BENCH_VARIANTS=general`
times the named variants only, without a comparison report.

## Limits

- One small app. The cost of a navigation in a large app is mostly its pages, not its regions.
- The memory history leaves out the History API's own cost, which is the browser's, not the
  framework's, and the same for every framework.
- Timings come from the benchmark VM, not a development machine.
