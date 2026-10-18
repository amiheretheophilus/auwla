# Memoized DOM Devtools

`@memoized-dom/devtools` owns the development inspector: its UI, self-hosted
Geist typography, bounded event store and versioned metadata protocol. It is
separate from application rendering and can evolve without changing component
authoring or the live-query protocol. It has no React or application-runtime
dependency.

## Open it

Run `memoized-dom dev`, then press **Alt+Shift+M**. The same shortcut closes it.
`?mmd-inspect` opens it automatically, including in browser automation.
Use the expand button for the full-window workbench; Escape inside the panel
closes it. System, light and dark themes are available.

No application import or component wrapper is needed. Vite installs the small
launcher automatically; the renderer, CSS and fonts load only when opened.
Production builds omit the launcher, UI assets and optional capture bridge.
To disable the launcher in development:

```ts
memoizedDom({
  clientEntry: 'src/main.ts',
  devtools: false,
});
```

## Views

- **Live** separates physical SSE connections from logical subscriptions. Select
  a source to inspect its live key, epoch/revision, patch sequence, optimistic
  protection and delivery state. Equal-key queries keep separate identities.
- **Events** lists attached handlers before the first click, with their component,
  file, line and relevant JSX. Its badge counts handlers, not invocations.
- **Regions** lists registered conditional regions. Generated internal boundaries
  are identified as internal rather than assigned an invented source location.
  Its badge counts regions, not checks or renders.
- **Issues** collects observed fallbacks, missing confirmations, patch recovery,
  repeated reconnects, failures and unmatched native-server invalidations.
  These are observations, not proof of an application bug.

Repeated trace-budget notices are grouped by browser/server origin and scope,
with an occurrence count. They mean tracing was sampled, not that a query failed
or the DOM changed. Issue disclosures keep their expanded state and focus while
new diagnostics arrive. The display filter does not change the capture budget.
Issues show the latest reported component, binding, source and triggering event
outside the metadata disclosure. Missing identity is labelled "Not reported".
For sampling notices this is the boundary where the budget was reached, not a
claim that this component caused every event in the window.

There are exactly four tabs: Live, Events, Regions and Issues. A handler/region
row briefly flashes when it runs; selecting it keeps its JSX visible through
later activity. Mounted sites are replayed on opening, without invoking them.
Unmount/HMR cleanup removes their registrations. **Clear history** resets the
activity counts but keeps attached sites. Console tracing remains separate.

Opening replays active source/connection metadata, not old event history. It
does not refetch, open application streams, subscribe to queries, or mutate
state. Closing removes its UI, capture, history and development-channel
listeners; application streams continue normally. Console tracing is independent:
opening the panel does not enable console spam. Clear history keeps current
source facts and does not change the application.

## Native server relay and privacy

Event and region details show the component name, authored file and exact line/column,
followed by the nearest JSX element with the expression or event attribute
highlighted—not the entire component. A labelled input shows its enclosing
`<label>…</label>` so the field and label remain together. The snippet is
scrollable, not a runtime-generated text label.
Selecting a record pins it while new events arrive. Internal protocol metadata
is secondary, under **Internal details**. Generated steps without an original
JSX anchor explicitly report that no authored location is available.

Their activity counts and pinned selections are separate; a condition check
does not prove a branch changed. The views share the same highlighted JSX detail.
Interactive server-page browser bindings participate too, in development only.

The compiler embeds this context only in development diagnostics output. Each
section is bounded to 24,000 characters (plus leading indentation); oversized
ancestors use a smaller enclosing section when possible. Synthetic server-page
companions do not pretend to be authored source. Imports, surrounding component
declarations and server preparation bodies are not included. No source-reading
HTTP endpoint is opened. **Static JSX literals and handler code are included**,
so keep development servers and diagnostic exports private. Source context is
not written to console traces.

The native Bun/Node development host relays sanitized server metadata over the
existing Vite HMR connection while an inspector is open. Async-local scopes
isolate concurrent Vite projects. **Server observations are instance-wide
development information, not restricted to the viewing browser's requests.**
The UI labels this explicitly. Matching a name/key is not request attribution.
Only use this on a trusted development server, not as a public monitoring tool.
Cloudflare's separate `workerd` host and non-native SSR hosts currently expose
browser diagnostics only; the UI reports that server relay is unavailable.

A whitelist copies only bounded metadata. Request/response bodies, full request
URLs, headers, cookies, authorization, input values, DOM nodes/text, application
state, service objects and exception contents are not collected as runtime values.
Authored JSX code is included in browser trace context as described above. Function names,
component paths and live keys **can still contain sensitive identifiers**.
Export metadata is an explicit download of the same sanitized records; keep
exports private. This is not a payload viewer, profiler, complete structural DOM
inspector, time-travel debugger or distributed invalidation inspector.

Unavailable owner labels, cursors and sequences are shown as unavailable, not
guessed. Trace event IDs describe synchronous handler work only. Existing runtime
coverage limits are documented in [runtime diagnostics](../../docs/runtime-diagnostics.md).

## Bounded cost

The default store retains 800 events, at most 256 source facts, 64 connections
and 80 issues. Active metadata providers are capped at 512 per browser realm.
Browser capture is capped at 1,000 events/second, runtime traces at 200/second
(100 for repetitive evaluations), and native relay at 500 events/second to at
most 16 opened inspector clients. Excess events are omitted, never queued for
later application work. The panel reports omissions. These limits mean the UI
is a diagnostic sample, not an exhaustive audit log. There is no background
capture history while closed; active metadata providers remain bounded.
A server relay detaches an inspector whose HMR socket has over 512 KiB buffered,
without closing application HMR. Reopen the inspector after the connection
recovers to resume server observations.

## Develop this package

```sh
bun run --cwd packages/devtools build
bun run test:devtools
```

The build copies CSS, local WOFF2 fonts and their licenses into `dist`. The
renderer uses a Shadow DOM and external stylesheet to isolate application CSS
and avoid injecting inline styles. It is intentionally a small DOM client,
avoiding a compiler/Vite build dependency cycle. Browser integration and
production-exclusion tests live in `packages/vite/tests/devtools-browser.test.ts`.

The exported protocol/store and `/node`, `/bootstrap`, `/client` entries are
tooling integration points, not imports application components need to use.
