# SSR experiments

Run from the repository root after building the workspace packages:

```sh
bun run bench:ssr:http
bun run bench:ssr:http --quick --repeats=1
bun run bench:ssr:http --filter=feed --repeats=3
bun run bench:ssr
```

`run.ts` (`bench:ssr`) times a string render of the table and dashboard, the
marker overhead, and hydration in LinkeDOM; it fails if hydration does not adopt
the server's nodes.

`http.ts` extends the original HTTP harness. It measures the in-process
`serve().fetch(Request)` → `Response.body` reader path. There is no socket,
proxy, TLS, browser parsing, or paint in these numbers. Fixtures are linked
with `compileModules()` before timing. Scenarios execute sequentially; three
rounds alternate their order to reduce consistent warmup/order bias.

The matrix covers a 1,000-row table; delayed data with stream, buffer, shell,
concurrent, timeout, deadline, reader-cancellation, and request-disconnect
policies; a slow consumer; concurrent routed preparation with distinct
request locals; and routed redirects. Each response is gated by its status,
render report, expected HTML and markers/payload. Cancelled and timed-out
request work must have aborted signals. Reports are awaited explicitly;
there is no guessed sleep for asynchronous disposal.

TTFB means first **document** byte. First application byte is a separate
metric: a fast head does not mean the page content is ready. Cancellation,
redirects, and empty-outlet error recovery have no application-byte sample.
Completion latency stops after reading/cancelling the response and before
validation. Batch throughput and CPU include validation, report observation,
and memory sampling; compare like scenarios and treat them as harness costs.

Memory is sampled every 5ms and at request completion. Heap and RSS growth
are sampled high-water observations, not precise peak live allocation counts;
short synchronous allocations can occur between samples. Slow consumption
tests retention of the atomic rendered body. It does not establish bounded
memory proportional to a small network chunk: the application still produces
one complete HTML string and its payload before delivery.

Raw per-request samples, outcomes, runtime versions, host CPU, and summary
statistics are saved to `dist/http-results.json`. `--quick` lowers concurrency
and request count for correctness verification; use the full matrix for
performance comparisons. Repeat measurements on an otherwise idle host.
Run performance measurements separately from builds and tests.

The old compiler's `ssrWriter` experiment (`writer.ts`, `--writer`, `--paired`) went
with that compiler; `RESULTS.md` keeps what it found.
