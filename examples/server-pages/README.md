# Server-owned page regions

From the repository root:

```sh
bun run example:server-pages
```

Open http://127.0.0.1:3100 in two tabs or browsers. If packages have not been
built yet, run `bun install` and `bun run build` first.

## What to try

1. Click the app-shell counter. It is outside every remote page region.
2. Click Orchard's local counter and type into its unsubmitted input.
3. In another tab, click Orchard +1. Both Orchard server counts update.
   The first tab keeps its local counter, input node/value, and focus.
   Harbor's server-render number and the app-shell counter do not change.
4. Change Harbor. Only Harbor's live key matches.
5. Submit a new Orchard title. The POST returns `page(<Receipt />)` directly,
   and the caller assigns it to the receipt region. Independently, its
   `updates` key notifies Orchard's live subscribers in both tabs.
   The previous receipt stays visible while the button says “Saving…”, then the
   completed receipt replaces it. Initial loading and errors keep their policies.
6. Reload and watch the progressive section: its heading/input appear first,
   then its summary, then its slower activity. Type while waiting: filling a
   sibling section does not replace that input. “Load a new result” retains the
   completed page until the replacement finishes.

The summary title and count have separate placeholders, but both consume the
same result and become available when the summary request resolves. Neither
waits for activity. No `suspend` is needed for this: it is normal source delivery,
not an atomic presentation workaround. The inline `<span>` loading policy is
valid inside these paragraphs; a block `<p>` fallback nested inside another `<p>`
is invalid HTML and browser reparsing can break the regions.

The page result is rendered on the server. The interactive Board receives
compiled browser bindings; the passive Receipt needs no component binding code.
The form uses existing `$forms`; no authored SSE endpoint or manual HTML insertion.

The shared count/title are collaborative deliberately: both tabs read the same
in-memory server records and observe matching board keys. Equal keys alone do
not share data or browser-local state. A private page can be live too: each
subscriber's query uses its own authenticated context, and user-scoped keys can
avoid unnecessary reruns for other users. Keys do not replace authorization.
See [Alice and Bob's private inboxes](../../docs/live-streaming-design.md#same-keys-private-data-and-collaboration).

## Where to look

- `server/functions/boards.tsx`: live page GET, data mutation, finite page GET,
  and finite page POST.
- `server/components/Board.tsx`: ordinary JSX with async local interaction.
- `src/App.tsx`: direct generated-source interpolation and explicit action target.
- `server.ts`: existing `serve()` with initial document streaming.

In Network → All/Fetch/XHR, compatible live reads from one tab normally share
one long-lived `POST /_memoized/live` stream. Its initial control payload lists
the Orchard and Harbor `getBoard` subscription URLs; later control requests can
add or remove subscriptions without reopening healthy siblings. A direct
`getBoard` SSE request can still appear when multiplexing is unavailable or the
route needs ordinary HTTP response semantics. Each tab owns its own connection.
`getReceipt`, `changeCount`, and `renameOrchard` are finite requests. The page
results from `getReceipt`, `renameOrchard`, and finite `getBoard` snapshots
return `text/html`: the rendered region followed by inert binding metadata,
not a JSON-wrapped HTML string. `changeCount` still returns ordinary JSON.
These are Fetch/XHR requests, not Document navigations. Live GET
rendering can appear in the terminal without another GET row: updates travel
over the already-open stream. Render numbers include SSR and reconnect reads
from all viewers, so initial numbers need not be 1 or match between tabs.
These are query-execution counters, not mutation counts or database versions.
A full reload executes SSR and then establishes fresh live subscriptions, which
can advance both labels without changing either board's count. The demo mounts
SSR only at `/`, so a missing `/favicon.ico` does not render the app.

After a rename, verbose `getBoard` snapshot messages describe the existing
Orchard live stream receiving the invalidated query's result. They do not mean
the form fetched its receipt again: that UI came from `renameOrchard`'s POST.
Compatible live updates can use compact HTML text edits plus binding-input
patches; reconnects still receive full results.

`getProgressiveBoard` is also a finite GET. On first document load its sections
arrive through SSR, without a duplicate browser GET. The reload button requests
one new finite HTML response; its nested data reads stay server-side. No SSE
connection is opened for that section.
The button explicitly uses `$track(progressive).refresh()`: calling the same GET
again can share its already-active cached result, which is not a forced reload.

This demo uses instance-local memory, resets on restart/HMR, and is not durable
storage. It has no optimistic update, so counters wait for the server response.
The passive `ProgressiveBoard` uses ordinary data functions with independent
`Group` policies, without `await` or a page-wide `suspend`. Its nested regions
arrive as they become ready, through one finite HTML response (or the initial
document stream). Supported fixed-binding interactive boards are unchanged;
mixed interactive components with render-time async reads still have the
existing compiler restrictions. This is not no-JavaScript progressive enhancement.

Build with `bun run example:server-pages:build`. Type-check after generating
types with `node packages/vite/dist/cli.js types --config examples/server-pages/vite.config.ts`,
then `bun check -p examples/server-pages/tsconfig.json`.

See [server-owned components](../../docs/server-components-design.md) for limits.
