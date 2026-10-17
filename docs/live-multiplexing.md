# Multiplexed live queries

Live browser queries share a fetch-based SSE connection within a data runtime
and compatible origin/header boundary. Authoring does not change:

```tsx
const notes = getNotes(expeditionId);
const summary = getSummary(expeditionId);
```

`live`, `updates`, `define.invalidate`, `page`, `Group`, `$track`, and optimistic
callbacks retain their meanings. Sharing transport does not share query data,
authorization, local UI state, cache ownership, or optimistic holds.

## Architecture

One query subscription engine owns invalidation tracking, request cancellation,
progressive page rendering, and stale-read rejection. Direct SSE and multiplexed
SSE use that same engine. Each subscription retains its own patch encoder,
sequence, and client baseline.

The shared connection owns framing, heartbeat, reconnect, and bounded delivery.
Ready subscriptions can deliver while another query is still pending. Frames
within a subscription remain ordered. Async validation and page binding loads
must not block unrelated subscriptions.

### Idle keep-alives

Live SSE sends a `: heartbeat` comment after **15 seconds without a delivered
frame** by default. It keeps the existing connection active; it does not make a
new request, rerun queries, or render UI. Actual frames restart the idle timer.
Multiplexed subscriptions share one heartbeat timer per connection, not one per
query. Direct live SSE uses the same policy.

Override the interval on the server application if your deployment needs it:

```ts
const app = serve({
  define,
  liveHeartbeatInterval: 30_000, // milliseconds; omit for 15,000
});
```

The value must be an integer from 1 to 2,147,483,647 milliseconds. Zero does not
disable heartbeats. Select an interval below your host/proxy idle timeout; a
longer heartbeat interval never delays real updates. The setting belongs to
this application, not to individual functions or browser subscriptions. Finite
responses and generator transports are unchanged.

### Subscription lifetime

The client batches initial subscriptions and subsequent subscribe/unsubscribe
controls. Adding a source does not reconnect mounted siblings. Replacing a
source or recovering its patch baseline uses a fresh subscription identity so
late frames cannot update the replacement. Losing the whole connection rebuilds
active subscriptions from full snapshots without discarding visible values or
the existing sources' optimistic protection.

Finite page responses, mutations, generators, and SSR reads keep their existing
transports. Direct live SSE remains supported for compatibility and for sources
outside the multiplexed server-function namespace.

## Request and security boundaries

Only registered live GET server functions are eligible. Every subscription runs
through its original route middleware, parameter/schema validation, and private
request state. Services/platform remain application-owned; mutable request state
is not shared between subscriptions. Subscription descriptors are not arbitrary
proxy requests.

Control requests require the connection's unguessable capability and matching
authentication headers, and reject cross-origin browser requests. Session
capabilities are transport-private, never authored keys. Different request-header
sets use separate connections. Authentication changes require reconnecting; an
existing long-lived request is not automatic session revocation.
Middleware that replaces the response or adds response headers is handled by a
direct-SSE fallback; its middleware can therefore execute again for that direct
request. The query itself is not executed during the multiplexed eligibility
dispatch. Authentication changes that reject controls surface as an error;
applications should clear their data runtime when changing identities.

Responses whose HTTP semantics cannot be represented inside a stream must not
silently turn redirects, cookies, or authorization failures into successful data.
Subscription failures are isolated from healthy siblings. Session/protocol errors
are connection-level failures, with bounded reconnect/backoff rather than loops.

## Limits and potential shortfalls

- **Single-instance session ownership.** Dynamic controls must reach the process
  holding the SSE session. An unknown/expired session requires reconnecting. This
  does not implement affinity, owner routing, or horizontal session distribution.
- **Invalidations remain instance-local.** Multiplexing does not implement the
  adapter discussed in [the cross-instance note](./live-adapters-discussion.md),
  nor strengthen mutation confirmation across different server epochs.
- **Not a CPU-sharing optimization.** Queries, rendering, JSON normalization,
  diffing, and baselines remain per subscription. Fewer connections do not remove
  those costs.
- **Shared failure and bandwidth boundary.** A network disconnect affects all
  subscriptions on that connection. A large frame still uses shared bandwidth.
  Queue, frame, session, and subscription limits protect against unbounded memory;
  overload must fail explicitly rather than drop dependent patches.
- **No cross-source transaction.** Back-to-back frames do not promise atomic
  visual updates. Existing `Group`/`suspend` behavior remains the presentation model.
- **Not cross-tab pooling.** Independent runtimes/tabs or incompatible credentials
  may still open separate connections. Custom fetch implementations remain in use.
- **Control requests have a cost.** An empty 204 body is not zero network traffic.
  Batching reduces chatter but does not eliminate requests.
- **Deployment requirements remain.** Hosts and proxies must allow streamed
  responses; idle timeouts, disconnect detection, and server restarts still matter.
  The request URL must reflect the public origin for origin validation; configure
  the host's trusted-proxy handling when TLS terminates at a reverse proxy.

See [live queries](./live-streaming-design.md) and
[server pages](./server-components-design.md) for the unchanged authoring model.

## Internal protocol and bounds

`POST /_memoized/live` opens a session with protocol version 1 and an initial
subscription list. A `session` event returns its private capability. Later POSTs
carry that capability and increasing control revisions, returning 204 after the
requested subscription changes are accepted. Subscription authorization/read
failures arrive as subscription-scoped events, not as successful query values.
Repeated control revisions are idempotent. Unknown sessions or skipped revisions
return 409, causing a reconnect with the current subscription set.

`value` and `patch` frames carry `sub`; patch sequences remain per subscription.
`error` and `fallback` apply only to the named subscription; `session-error` is
terminal for the connection. A baseline mismatch gets one isolated recovery
attempt until successful sequential delivery demonstrates progress. Network and
lost-session retries back off from 1 second to 30 seconds; authorization and
invalid-protocol failures are terminal, not an automatic retry loop.

Current safety bounds are 256 sessions per router, 64 subscriptions per session,
8 concurrent query executions per session, 4096 subscription identities per
session, 64 KiB controls, 1 MiB frames, and 4 MiB server queued frames. The client
allows 2 MiB pending decoding per subscription and 8 MiB per connection. Capacity
failures are explicit; already-encoded dependent patches are never silently
dropped. Capacity exhaustion may require source refresh or an application retry.
These are guardrails, not a substitute for deployment-level rate limiting.
