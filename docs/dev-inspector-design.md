# Development inspector design

Status: initial implementation available in `@memoized-dom/devtools`. The
separate package owns the UI, self-hosted typography, bounded capture and
versioned metadata protocol. Vite provides the development-only launcher without
application imports. See [usage and limits](../packages/devtools/README.md).

## Why add an inspector

The existing development diagnostics are intentionally console-based. Live
messages explain invalidation, query delivery, patch protection and optimistic
holds, while runtime traces explain events, published writes, update units,
binding evaluation and DOM writes.

Multiplexing makes the browser Network panel less explanatory: one physical SSE
request can carry several independent live queries. A developer should not have
to correlate that request manually with server logs and many console objects to
answer why one value updated, waited, reconnected or switched to direct SSE.

The inspector is a presentation layer over the existing diagnostic model. It
must not introduce a second invalidation, tracking or delivery system.

## Intended author experience

During `memoized-dom dev`, the inspector is closed and invisible by default.
`Alt+Shift+M` opens or closes a development-only panel. `?mmd-inspect` opens it
automatically, including for browser automation. The panel supports a docked view,
expanded workbench, filters, metadata export and system/light/dark themes.

No application import, component wrapper, server-function option or middleware
change should be required. Production builds must omit the panel, its event
bridge and compiler tracing hooks that are not otherwise requested.

The first version has three views.

### Live

Show physical connections and their logical subscriptions separately:

- transport (`multiplexed` or `direct SSE`) and connection state;
- server-function name and opaque source identity;
- resolved live key, epoch/revision and patch sequence;
- latest delivery state (`querying`, `held`, `applied`, `error`);
- pending optimistic operation count;
- reconnect attempts; and
- the reason a subscription switched to direct SSE.

Equal keys do not merge query identity. The view must keep two server functions
with the same key as separate subscriptions while showing that one invalidation
matched both.

### Events and Regions

There are four tabs only: Live, Events, Regions and Issues. Events lists attached
handlers before invocation; Regions lists mounted conditional regions before
their next check. A row flashes when its handler/region runs. Registrations are
replayed when capture opens and released at owner disposal, including HMR.
Each tab retains its own selection. Badges count attached sites; activity counts
are separate and do not imply component rerenders or branch replacement.

The primary detail is authored JSX: component name, file, exact line/column and
the nearest JSX element (including the label around a labelled input), with
the handler or expression highlighted. Do not show the whole component. Show
plain action labels (for example, “Click handler ran” or “Text updated”), not
raw protocol names and JSON as the first explanation. Keep protocol metadata
under Internal details. Selecting a record pins it and reveals its code even
in the narrow dock. Generated steps without original locations say so, rather
than displaying an invented source address. This source context is development
only and includes static JSX literals/handler code, not runtime value capture.

Present the existing runtime trace as a causality-oriented timeline:

```text
event started
  -> write published
  -> update started
  -> binding evaluated
  -> DOM write
  -> update completed
```

Filters use the existing component and source labels. The UI must retain the
documented distinction between an evaluated binding, an executed DOM write and
a browser paint. It is a debugger, not a profiler.

### Issues

Collect actionable development warnings without inventing certainty:

- an invalidation matched no active key;
- a successful optimistic operation supplied no confirmation;
- a snapshot is held and why;
- a connection repeatedly reconnects;
- middleware required direct-SSE fallback;
- a malformed frame or sequence mismatch terminated delivery; and
- a server capacity or protocol invariant closed a session.

An unmatched key remains an observation rather than an error: the intended
subscriber may not be mounted or may live on another application instance.

## Event architecture

Console messages remain supported. The live and runtime reporters should also
publish structured internal events to a bounded development sink. The panel
subscribes to that sink directly and never parses console output.

Browser events remain local. The native Bun/Node Vite development host relays
sanitized server events through the existing HMR channel to opened inspectors.
Async-local scopes isolate concurrent Vite projects, but server observations
are instance-wide, not per-browser request data. Names/keys can match another
viewer's work; the UI does not claim request attribution. Cloudflare's separate
`workerd` host and non-native SSR hosts currently have browser diagnostics only.
The application SSE protocol must not carry inspector events merely to support
the UI. Non-Vite hosts keep console diagnostics unless they explicitly install
an equivalent development sink. Only use the relay on a trusted development server.

The panel should mount in a Shadow DOM so application styles cannot affect it
and inspector styles cannot affect the application. Event history is a bounded
ring buffer. Closing the panel releases retained history and subscriptions.
Diagnostics must never delay application work or change settlement, cleanup,
reconnection or error propagation.

## Privacy and security boundaries

Do not collect or display:

- request or response bodies;
- cookies or authorization headers;
- input values, event objects or DOM text values;
- application state or service objects; or
- complete request URLs containing query input.

Function names, component paths and live keys can themselves be sensitive, so
the inspector remains development-only. Exported reports must be explicitly
requested and redacted by the same rules. The UI must not expose controls that
can mutate server state, resend mutations or alter live cursors.

## Staged delivery

1. Define one versioned internal event shape and adapt the current console
   reporters without changing their output.
2. Add the live view for connections, subscriptions, fallbacks, reconnects,
   patches and optimistic holds.
3. Add the issue summary and bounded report export.
4. Add the reactivity timeline using the existing compiler/runtime trace hooks.
5. Only after the event model proves stable, consider a browser DevTools
   extension consuming the same protocol.

A browser extension is deliberately not the first implementation. An in-page
development panel has no installation step, works across supported browsers and
lets the event model mature before committing to extension APIs.

## Non-goals

The inspector does not add automatic data dependency discovery, distributed
invalidation, payload inspection, DOM mutation observation, time-travel state,
performance profiling or a production monitoring agent. It explains the work
Memoized DOM already performs.
