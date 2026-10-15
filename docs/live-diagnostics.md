# Debugging live queries and optimistic updates

Development diagnostics explain the existing live protocol without changing
function signatures, optimistic callbacks, invalidation rules, or delivery.
There is no additional inspector package, dashboard, subscription, or retained
event history.

## Finding the messages

Run the application with `memoized-dom dev`. Browser diagnostics use Vite's
development mode. Directly hosted server code outside Vite's transformation
uses `NODE_ENV=development`. Production mode does not emit these messages;
outside Vite, an unset `NODE_ENV` does not enable them either.

In browser DevTools, enable the **Verbose** console level and filter for
`[memoized-dom:live]`. Server subscription, invalidation, and query traces appear
in the development server console. Browser protection and delivery traces appear
in the browser console. Warnings remain visible without enabling Verbose.

Diagnostics record keys, revision/epoch stamps, pending counts, and server
function paths, not response payloads, request bodies, cookies, or service state.
Callback failures include the original error. Keys and application errors can
themselves contain sensitive information: keep development logs private.
No diagnostic events or additional user keys are sent over the live connection.

## A mutation succeeds, but a query does not update

Compare the resolved keys in `subscribe` and `invalidate`, including segment
types and order. For example:

```text
subscribe
  key: '["expedition-notes","canopy"]'

invalidate
  key: '["expedition-note","canopy"]'
  matchedKeys: []
  subscribers: 0
  reason: 'no-active-match'
```

The singular/plural mismatch does not invalidate that subscription. A matching
invalidation lists its affected query keys and total active subscriber count.
`unsubscribe` records the remaining subscriber count for its key.

An empty match is a trace, not a warning or error. The query may never have
mounted, may have unmounted, or may be subscribed on another application instance.
A log cannot prove the author's intended relation. This does not implement
compile-time key checking or automatic database dependency tracking.

Keys keep the existing structural prefix rule: a child mutation can affect its
parent overview, but not a sibling detail. Numeric and string IDs are different
segments. `live`, `updates`, and HTTP handlers still receive context followed by
the same positional arguments.

## A query ran, but its result was not sent

`query-started` identifies the function path and revision being read.
`query-discarded`, with `reason: 'invalidated-during-read'`, means an invalidation
arrived before that evaluation finished. The stream discards the old result and
reruns the query rather than labelling it with a newer revision.
`query-delivered` records the stamp after enqueueing the result, not after a DOM
paint. These traces do not measure CPU time.

## The browser receives data, but the visible value stays unchanged

| Message | Meaning |
| --- | --- |
| `snapshot-received` | A complete value reached protection, including a value reconstructed from patches. |
| `protection-started` | An associated optimistic operation increased the pending count. |
| `snapshot-held`, `optimistic-pending` | The latest value waits for associated operations to settle. |
| `protection-released` | An operation settled/cancelled; inspect the remaining count and confirmations. |
| `snapshot-held`, `awaiting-mutation-confirmation` | The buffered revision predates a successful mutation acknowledgement. |
| `snapshot-rejected`, `older-than-received` | An older revision from the same query and epoch arrived after a newer one. |
| `confirmation-ignored`, `unrelated-key` | A mutation key does not overlap this query. This can be intentional for multi-source operations. |
| `snapshot-applied` | Protection allowed the complete value to commit to the data source. |
| `confirmation-epoch-changed` | The confirmation and incoming epoch cannot be compared; existing policy accepts the new epoch's snapshot. |

`snapshot-applied` describes a data-source commit, not completion of a DOM paint.
An epoch change can be a server restart; it does not establish that a distributed
deployment is safe. [Cross-instance invalidation](./live-adapters-discussion.md)
remains unresolved. Diagnostics expose that boundary, not extend the guarantee.
Expected buffering is not an error; only the newest complete value is retained.

## A successful optimistic operation supplied no confirmation

If an optimistic helper protects live sources but its successful result has no
mutation confirmation, development warns with `missing-mutation-confirmation`,
`reason: 'pending-only-protection'`, and the protected query keys (or `null` when
the initial stream has not supplied a key yet).

Pending protection still works. Without a cursor, the framework cannot reject an
older buffered snapshot using that operation's acknowledgement. Return the
generated server-function result directly when relying on its confirmations.
A successful server function without `updates` also supplies no confirmation.
Wrapping a result in an ordinary promise can lose source metadata even when its
payload is unchanged. An async action forgetting to return still returns a valid
`Promise<void>`; this differs from a synchronous missing return.

Ordinary promises remain supported. The warning explains a weaker guarantee,
not an error, required validation, automatic refetch, or changed optimistic API.
Unprotected promises and unsuccessful operations do not produce this warning.

## Invalid optimistic actions and callbacks

A synchronous action returning nothing already throws
`optimistic action must return a trackable source or promise`. It does not run
`apply`, and protection is released. The action itself may already have dispatched
a mutation before its missing return was detected.

If `reconcile` or rollback throws, `optimistic-callback-failed` identifies the phase
and operation ID and includes the original error. The error continues through
existing caller/host reporting; the warning does not swallow it or change the
remote mutation's outcome. Protection is released even when a callback fails.
Correcting application state after that error is the application's responsibility.

Different mutation/query shapes are not inherently invalid. A POST returning one
note and a live query returning an array of notes is normal; `reconcile` connects
them. The framework cannot infer a domain mistake if a callback silently updates
the wrong record without throwing. Inferred types and application tests remain
important; validation is optional.

Requests remain concurrent. Optional grouping IDs group reconciliation, not
request execution or database write order. See [optimistic utilities](../packages/utils/README.md)
and [live protection](./live-streaming-design.md#optimistic-authoring-preserve-callbacks-associate-the-source)
for authoring examples. These diagnostics do not add generator delta delivery or
a distributed invalidation adapter.
