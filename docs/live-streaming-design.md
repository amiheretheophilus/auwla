# Live queries and streaming functions

Implemented: live GET queries, automatic smaller-patch delivery, mutation
invalidation, single/multiple optimistic source protection, and async generator
server functions. This document began as
the authoring design and now describes the implementation and its boundaries.
Invalidation is application-instance-local; it is not a distributed database feed.
Cross-instance support is [under discussion](./live-adapters-discussion.md);
no adapter API has been selected or implemented.
For resolved keys, pending holds, rejected snapshots, and missing mutation
confirmations, see [development diagnostics](./live-diagnostics.md).
Server functions returning `page(...)` reuse these live connections. Their
initial passive HTML can reveal ready sections independently; subsequent live
renders retain the completed page while new sections settle. See
[colorless progressive page delivery](./server-components-design.md#colorless-progressive-page-delivery).

## What this adds

Authors write ordinary typed server functions and consume their results as
reactive values. The compiler and runtime own streaming transport, generated
endpoints, subscription lifetimes, and delivery to the existing data source.
Authors do not write SSE routes, message parsers, `watch()` methods, or client
event handlers for live queries.

This does not replace existing SSR streaming. SSR `mode: 'stream'` delivers
initial regions as their reads settle and then finishes. A live query keeps an
already-open page synchronized with subsequent server changes.

Returning server-owned UI rather than data is documented separately in
[server-owned components through `page(...)`](./server-components-design.md).
The live examples in this document return data; page sources reuse their
invalidation and transport model with the boundaries described in that guide.

## Server authoring: declare what a query observes

Keep the existing shared definition and discovery layout:

```ts
// server/define.ts
import { createDefine } from '@memoized-dom/server';

export const define = createDefine<{ visitor: string }>();
```

Export service definitions under the configured server root and server
functions under `server/functions`. Services keep ordinary methods: `all`,
`add`, and `remove` below read or change application data; they do not need to
implement a feed. The services receive their existing generated types.

```ts
// server/functions/notes.ts
import { define } from '../define';

export const getNotes = define.function({
  async get({ services }, expeditionId: string) {
    return services.notes.all(expeditionId);
  },
  live: (_context, expeditionId) =>
    ['expedition-notes', expeditionId],
});

export const postNote = define.function({
  async post({ state, services }, expeditionId: string, text: string) {
    return services.notes.add(expeditionId, text, state.visitor);
  },
  updates: (_context, expeditionId) =>
    ['expedition-notes', expeditionId],
});

export const deleteNote = define.function({
  async delete({ services }, expeditionId: string, noteId: string) {
    return services.notes.remove(expeditionId, noteId);
  },
  updates: (_context, expeditionId) =>
    ['expedition-notes', expeditionId],
});
```

`live` and `updates` receive the injected context first, then **the same server
arguments as the HTTP handler, in the same positional order**. Parameter names
do not determine the match: `id` and `expeditionId` may name the same argument.
Their types are inferred from the handler, so repeating annotations is optional.
To infer callback argument types from the handler, declare the HTTP handler
before `live`/`updates`, as above. A callback above the handler remains supported
when its arguments are explicitly typed.
Callbacks may omit unused trailing arguments, but skipping an earlier argument
requires a placeholder. For a handler whose arguments are `text, expeditionId`:

```ts
export const postNote = define.function({
  async post({ state, services }, text: string, expeditionId: string) {
    return services.notes.add(expeditionId, text, state.visitor);
  },
  updates: (_context, _text, id) => ['expedition-notes', id],
});

// The framework supplies context; authors pass only the transported arguments.
postNote('New note', 'ice-cores');
// updates receives (_context, 'New note', 'ice-cores'), so id is 'ice-cores'.
```

This argument rule applies equally to `live` and `updates`. Validation remains
optional. With `input`, the client sends the schema's input and both the handler
and key callback receive the same validated/transformed server value. Neither
callback receives the handler's return value as an extra argument. Keys are not
URLs or additional client-call arguments. The current scope is ordinary GET
queries with `live` and mutation functions with `updates`; generators have a
separate role below.

### Hierarchical keys: overview and targeted details

Keys are nonempty arrays of finite JSON primitives, matched by complete segments.
An overview can observe an entire family, while details observe one member:

```ts
export const getExpeditions = define.function({
  live: () => ['expedition-notes'],
  async get({ services }) {
    return services.expeditions.all().map(expedition => ({
      id: expedition.id,
      name: expedition.name,
      notes: expedition.notes.length,
    }));
  },
});

// getNotes and the detail summary retain ['expedition-notes', expeditionId].
// postNote and deleteNote invalidate ['expedition-notes', expeditionId].
```

Invalidating `['expedition-notes', 'ice-cores']` updates exact matches, ancestor
queries such as `['expedition-notes']`, and any more-specific descendants of
that expedition. It does not rerun sibling details such as
`['expedition-notes', 'canopy']`, or queries in another family. Invalidating the
parent `['expedition-notes']` deliberately updates that whole family.

This is structural prefix matching, not string-prefix matching or a wildcard:
`'ice'` does not match `'ice-cores'`, and the number `1` does not match the string
`'1'`. Only mounted/active queries are rerun; invalidation does not open new
subscriptions or share computed results between subscribers. The server indexes
active query prefixes rather than scanning unrelated query families. The same
rules apply to `define.invalidate(key)` and generator mutation completion.

After a successful mutation, the framework invalidates its declared key,
reruns matching active queries on the server, and streams their updated values.
The mutation still returns its normal result to the caller. There is no extra
browser GET after the mutation, although updating a live query does perform its
server-side read again. This is invalidation-driven querying, not automatic
database observation.

Changes that occur outside these functions use an explicit boundary:

```ts
await services.notes.importFromJob(expeditionId);
define.invalidate(['expedition-notes', expeditionId]);
```

Publish invalidations after changes commit. Transactions, partially committed
failures, and changes made by other applications need an appropriate integration;
successful function completion alone cannot reveal arbitrary database writes.

## Same keys, private data, and collaboration

**A live key identifies which queries to notify. It does not identify a shared
result, select a user's data, or synchronize browser-local state.**

Keep three things separate:

- **Browser-local state:** local counters, open panels, drafts, and focus belong
  to that browser/component instance. Declaring a query `live` does not share them.
- **Server data and authorization:** the handler decides which data the viewer
  may read or change, using that viewer's authenticated request context.
- **Invalidation keys:** matching keys notify active queries to run again. Each
  query uses its own subscriber context, not the mutating caller's context.

### Alice and Bob: same key, separate private inboxes

In this separate inbox example, assume the shared `define` declares
`state.userId: string`, and authentication middleware sets it from a verified
session. `services.messages.forUser()` and `addForUser()` are application-owned
data-access methods; they must enforce the appropriate access rules.

```ts
export const getInbox = define.function({
  async get({ state, services }) {
    return services.messages.forUser(state.userId);
  },
  live: () => ['inbox'],
});

export const addMessage = define.function({
  async post({ state, services }, text: string) {
    return services.messages.addForUser(state.userId, text);
  },
  updates: () => ['inbox'],
});
```

Alice opens her inbox and Bob opens his. Both live queries observe `['inbox']`,
but their connections have different authenticated contexts.

When Alice adds an item to her own inbox:

1. The mutation changes Alice's data, then invalidates `['inbox']`.
2. Alice's query runs again with **Alice's user ID** and returns her updated inbox.
3. Bob's query also runs again, but with **Bob's user ID**. It returns his own
   unchanged inbox, not Alice's messages.

The invalidation is a notification, not a broadcast of Alice's data or rendered
HTML. Same-key subscribers do not share a computed result or a connection merely
because their keys match. Here the broad key causes an unnecessary read for Bob;
it does not make the inboxes collaborative.

### User-specific keys avoid unrelated reruns

Replace the callbacks in those same two definitions with:

```ts
// On getInbox:
live: ({ state }) => ['inbox', state.userId]

// On addMessage; context first, then the handler's positional arguments:
updates: ({ state }, _text) => ['inbox', state.userId]
```

Now Alice's query observes `['inbox', 'alice']` and Bob's observes
`['inbox', 'bob']`. Alice's mutation invalidates her key, so Bob's sibling key is
not notified. Alice's other tabs observing her inbox still update normally.

The existing [prefix rule](#hierarchical-keys-overview-and-targeted-details)
still applies: deliberately invalidating the parent `['inbox']` notifies both
users' queries. **User-specific keys are an efficiency boundary, not an
authorization boundary.** Handlers must continue selecting and authorizing the
correct data; making a key more specific cannot repair an unsafe query.

Each live connection retains its opening request's context. Middleware is not
rerun for each invalidation; check current permissions in the handler when access
can be revoked, as described under [security boundaries](#runtime-and-security-boundaries).

### When it becomes collaborative

It becomes collaborative when authorized viewers read and mutate the **same
underlying server data**, and matching keys notify their live views. For example,
members of one project can observe `['project-board', projectId]`. Their handlers
must still check project membership. Sharing that key does not share their local
drafts, open panels, or focus.

This applies to both data-returning queries and server-owned `page(...)` results.
For a page result, each subscriber's handler renders that subscriber's permitted
UI; the framework does not render once as Alice and send her page to Bob.

The server-pages example is collaborative deliberately: both browsers access the
same in-memory board records and matching board keys. The shared records, not
the key alone, make the displayed server count/title shared.

Live is also useful for private inboxes, a user's background jobs, and private
order status. It does not require a collaborative application or globally shared
pages. Use a finite query when ongoing updates are not needed. In either case,
live notifications still require the declared `updates` or explicit invalidation;
the framework does not automatically observe database writes.

## Client authoring: an ordinary reactive result

```tsx
import { getNotes } from '#server-functions';

export function Notes(expeditionId: string) {
  const notes = getNotes(expeditionId);

  return (
    <ul>
      {notes.map(note => (
        <li key={note.id}>{note.text}</li>
      ))}
    </ul>
  );
}
```

If the query returns `Note[]`, `notes` is typed as `Note[]`, not an event source,
promise wrapper, or generator. Existing `Group`, `suspend`, and `$track` remain
the ways to author initial pending/error UI and inspect the data source.

The framework loads the initial value and owns the live subscription. Incoming
results replace the source's confirmed value; compiled JSX updates its DOM.
Changing the query arguments rebinds the source. Unmounting releases the
subscription; the underlying connection closes when no consumers remain.
GET functions without `live` retain their existing single-result behavior.

SSR obtains an initial value and transfers it for hydration; it does not wait
for a live connection to finish. After adoption, the browser opens a live
connection and receives a fresh snapshot, covering changes since SSR. `$routed`
remains a finite preparation gate. Its cached payload does not itself own a
live subscription: declare the live source in the mounted component when
ongoing updates are needed.

## Optimistic authoring: preserve callbacks, associate the source

```tsx
import { getNotes, postNote } from '#server-functions';
import { optimistic } from '@memoized-dom/utils';

export function Notes(expeditionId: string) {
  const notes = getNotes(expeditionId);

  const saveNote = optimistic({
    source: notes,

    action: (text: string) => postNote(expeditionId, text),

    apply(text, operationId) {
      notes.push({ id: operationId, text, by: 'you' });
      return () => {
        const index = notes.findIndex(note => note.id === operationId);
        if (index !== -1) notes.splice(index, 1);
      };
    },

    reconcile(saved, _text, operationId) {
      const index = notes.findIndex(note => note.id === operationId);
      if (index !== -1) notes.splice(index, 1, saved);
    },
  });

  return (
    <section>
      <button onClick={() => saveNote('New field note')}>Add note</button>
      <ul>{notes.map(note => <li key={note.id}>{note.text}</li>)}</ul>
    </section>
  );
}
```

Use `source: notes` for one source or `source: [notes, summary]` for multiple
sources. Both are optional additions to the existing callback-based approach.
For example, an optimistic note insertion can protect its notes list and the
live note-count summary, incrementing the count in `apply` and decrementing it
in rollback. Each source waits for all of its own associated operations; an
unrelated source continues updating normally.

`source: notes` associates the operation with the compiler-owned live source,
not a copy of its array and not another request. The compiler preserves this
as a source reference rather than its current payload. Unsupported plain
arrays/objects produce an error rather than silently failing to protect data.
Use direct live-source bindings or an explicit array of those bindings inside
the imported `optimistic` call. Arbitrary derived values and dynamically
assembled source lists are outside this compiler-preserved authoring contract.

The framework cannot reliably infer this relationship from arbitrary closures.
`apply` might change an array through a helper or alias, update several objects,
or touch unrelated state. An explicit source avoids treating unrelated live
queries as if they belonged to the mutation.

### Protection, not optimistic overlays

Protection does not analyze, extract, or replay optimistic callback changes:

1. Protect the associated source before starting each operation.
2. Start the request and run `apply` immediately, preserving current concurrency.
3. While associated operations remain pending, retain the newest incoming
   snapshot without applying it to the displayed value.
4. Run normal successful reconciliation or operation-specific rollback.
5. Release protection after settlement callbacks, including failure paths.
6. When no associated operations remain, allow an eligible current snapshot to
   update the source.

For example, `[A, B, temporaryC]` stays visible while C's request is pending,
even if another user's update arrives as `[A, B, D]`. C reconciles or rolls back
first; a current confirmed snapshot can then become visible. This avoids losing
the placeholder that the authored reconciliation callback expects to find.

Protection is shared by operations associated with the same underlying source,
including different optimistic helpers. A complete-array snapshot must not
replace that array while any associated operation is still pending. Unrelated
sources continue updating. Retain the latest snapshot, not an unbounded queue.

The source association is optional for existing non-streaming usage. Existing
`apply`, rollback, `reconcile`, request return values, and optional grouping IDs
keep their meanings. For independent row insertions, omit the grouping ID so
each successful insertion reconciles. For repeated writes to one value, the
existing `save(payload, { id })` still groups reconciliation; `source` separately
protects against incoming stream snapshots. It does not select a group winner
or serialize requests.

There is a real timing constraint: the last received snapshot may predate a
successful mutation. The protocol carries internal change cursors and mutation
acknowledgements so such a snapshot cannot undo the reconciled result. Protection
does not simply flush any buffered snapshot when its counter reaches zero. These
are framework-owned delivery positions, not author-provided entity versions,
and do not establish database write order. In-flight live queries discard their
result and rerun if their dependency changed while they were evaluating.
Acknowledgements follow the same hierarchy: a child mutation protects an
associated parent overview, and a family-wide mutation protects associated
descendants. Sibling mutation cursors do not hold an unrelated detail source.

This acknowledgement guarantee uses the generated server-function result.
An ordinary promise can still protect a source until it settles, but it does
not carry the framework's mutation cursor; it cannot reject older snapshots
on that basis. Return the server-function result directly when relying on
automatic mutation acknowledgements.

The deliberate tradeoff: external changes to this source are delayed while its
optimistic operations remain pending. Long-pending operations can delay updates.
There is no guarantee for arbitrary writes made outside the associated helper,
and cancellation cannot prove that a remote mutation did not commit.

## Generator functions: incremental results, not required for live queries

Use a normal live query when the framework can rerun a normal query on declared
changes. Use a generator when an operation itself naturally produces successive
values, such as generated text or job progress:

```ts
export const generateAnswer = define.function({
  async *post({ services, request }, prompt: string) {
    let answer = '';
    for await (const token of services.ai.generate(prompt, {
      signal: request.signal,
    })) {
      answer += token;
      yield answer;
    }
    return answer;
  },
});
```

The compiler recognizes the generator and generates the transport. The client
receives a transparent reactive string, not an `AsyncGenerator`. Every yielded
value represents the current complete result; appending text is explicit in the
server function above. Arrays likewise yield complete arrays, not implicit
append operations or custom added/deleted event protocols.

Tracking semantics:

- `pending`: waiting for the first value.
- `streaming`: the streaming operation is open or reconnecting, including while
  waiting for its first value. `pending` distinguishes that initial wait.
- `onSuccess`: once on successful completion, not once per yield.
- Errors distinguish an initial failure from a failure after delivering data.

Successful completion must not cause optimistic reconciliation on every yield.
The client type is inferred from yielded values, not the generator's return
value. `return` ends execution but does not publish another payload. Completion
reports the last yielded value once to `onSuccess`. A generator must yield at
least one JSON-serializable value; an empty generator is an error. Forms
submitting generator actions also wait for completion before accepting a result.
Live GET `onSuccess` observes initial fulfillment once per execution, rather
than firing for every subsequent snapshot.

Do not automatically restart a POST generator after a network interruption:
that could repeat side effects. This implementation explicitly fails interrupted
generators rather than restarting them. Safe resumption would need an execution
identity and retained/durable state. A live read query reconnects by obtaining a
fresh snapshot; a mutation stream is not equivalent.
Closing a connection and cancelling an underlying durable job are separate
application decisions.

## Runtime and security boundaries

- Use the existing typed context, middleware, and service injection. Re-evaluated
  queries retain their own authorized context; never evaluate every subscriber
  using the mutating caller's context.
- Dependency keys identify invalidation audiences, not authorization. Do not
  share a computed result between users merely because their keys match.
- Middleware authorizes the opening request. Query re-evaluations retain that
  request's context; they do not rerun its middleware. Applications with
  revocable permissions should check current access in the query or terminate
  the connection when access changes.
- Bound buffers and apply backpressure. Clean up subscriptions on unmount,
  cancellation, argument changes, and application shutdown.
- Reconnect live queries with cursor-aware recovery or a current snapshot, keep
  the last successful value during transient disconnection, and expose status.
- Process-local invalidations do not reach another server instance. Cross-instance
  support is [under discussion](./live-adapters-discussion.md), with no adapter
  API selected or implemented.
- SSE is a transport choice, not the author-facing API. Its use still requires
  deployment support for streaming responses, authentication, and cancellation.

## Delivery and current limits

Live queries reconnect after transient transport failures with bounded backoff
(up to 30 seconds), keeping their last successful data. Authorization failures,
declared query errors, and malformed frames are terminal; `$track(source).error`
reports the failure and explicit `refresh()` can retry. `abort()` and final
ownership release stop the source and reconnection. Equivalent active live
sources share one request/cache entry; ordinary and streaming requests do not
share transport identities even if their URLs match.

The framework sends JSON snapshots or smaller patches over an internal fetch-based
SSE protocol for live GET queries, as described below. Generator yields remain
complete-value frames.
The generated facade handles headers and bodies; no authored SSE endpoint or
EventSource wiring is needed. Complete values replace the source rather than
implicitly appending array items. Parsing supports fragmented UTF-8 and CRLF/LF
lines and rejects frames over 1 MiB. Server live queries use backpressure, one
queued frame, coalesced invalidations, and 5-second idle heartbeats. Deployments
still need a host and proxy that permit streamed responses.
Each distinct active live query uses its own connection; this implementation
does not multiplex query subscriptions. Host and browser connection limits
therefore matter when mounting many different live queries simultaneously.

SSR consumes a finite query snapshot or one generator GET yield. Hydration
retains that transferred value and reconnects live GET sources after adoption.
Reconnections supply current snapshots, not a historical event log. A generator
GET's restored first yield remains finite; hydration does not restart it.
While a live GET's finite snapshot is being prepared, only overlapping key
invalidations trigger a consistency retry; unrelated mutations do not restart
the read. A retry aborts its discarded attempt and releases its response body
or iterator, including nested progressive page rendering. Temporary snapshot
tracking is released on success, failure, or cancellation; it does not leave
an SSE subscription behind.
Live values cached as ordinary `$routed` payloads are payloads, not subscriptions:
declare the live source in the mounted component to receive ongoing updates.

No automatic browser GET follows a successful mutation. Its result reconciles
the caller; invalidation reruns subscribed queries on the server and streams
their values. Multiple sources are independently protected and updated; separate
connections do not promise atomic visual delivery across sources.

## Automatic patch delivery for live GET queries

This is an internal transport optimization, not a new authoring or data model.
Existing `define.function({ get, live })`, `updates`, `Group`, `suspend`, `$track`,
and optimistic callbacks keep their current meanings. Authors do not calculate
patches, supply entity versions, or handle transport messages. A `Note[]` remains
a complete reactive `Note[]` in component code.

### Snapshots first, patches only when useful

The browser advertises patch support through an internal request header. A server
receiving no advertisement continues sending complete values; an updated client
also accepts older complete-value servers. No configuration flag or import is
needed in application code.

Each new live connection starts with a full snapshot. After invalidation, the
server still runs the authorized query and compares its new JSON-normalized
result with the last result sent on that connection. It may send internal JSON
Pointer `add`, `remove`, and `replace` operations. For example, one overview count
can become a replacement at `/2/notes`, rather than retransmitting every row.
This internal subset is not an author-facing general-purpose patch API.

Updated clients advertise `x-mmd-live-patches: 2`. Version 2 also supports an
internal `text` operation for the root `/html` field of a compatible interactive
server page (same page ID and binding key). It retains the common string prefix
and suffix and sends the changed middle with UTF-16 offsets. Binding inputs
continue using ordinary JSON operations. Applying the edit reconstructs the
complete exact HTML, including Unicode, so later mounts and replacements never
reuse an obsolete HTML baseline. It does not morph DOM or assume an unchanging
template. A large or unhelpful edit uses replacement/snapshot delivery instead.

Version 1 clients receive only the original operations. A server without patch
support can still send complete values to a version 2 client. Every connection,
including a reconnect, establishes a full baseline first. Server render/query
work still occurs per subscriber; these edits reduce transfer size, not that
work. They do not eliminate full-value serialization or baseline storage.

The server compares complete UTF-8 frame sizes, including metadata. It sends a
patch only when it is strictly smaller; otherwise it sends another full snapshot.
The payload is serialized once for normalization, and that JSON is reused if a
snapshot is selected. A winning patch does not require constructing or UTF-8
encoding a discarded full snapshot. Small patches can be selected from a safe
size lower bound; close comparisons count exact UTF-8 bytes without allocating
the full snapshot buffer. Unicode content and equal-size ties retain the same
selection rule.
Diff work is bounded to 50,000 work units, 128 operations, and 64 path segments.
Exceeding a bound falls back to the full snapshot. Arrays first align structurally
equal prefixes and suffixes; only their changed middle is diffed. This keeps a
prepend, removal, append, or middle edit compact without treating every shifted
index as a changed row. Equality checks share the same work/depth budget and
preserve object-property order. No `id` field or compiled JSX `key` is assumed;
duplicates and nested arrays work too. This is not an unbounded edit-distance or
move-detection algorithm: many disjoint edits or large reorderings can still make
a full snapshot cheaper. Regression coverage includes compact patches for the
four reported edit cases on 5,000 three-field rows; there is no universal row-count
threshold because work depends on each value's shape.
Object-property enumeration order is preserved too; an object is replaced when
individual member updates would leave its keys in a different order.

Each connection maintains its own baseline under its subscriber's authorized
context. Baselines and computed values are not shared between users because
their invalidation keys happen to match. JSON normalization also snapshots
mutable service results: retaining a service's array reference would let later
backend writes corrupt the previous baseline. Values retain existing JSON
serialization semantics, such as Dates becoming strings.

### Reconstruction and optimistic protection

The browser keeps a private confirmed transport baseline, separate from the
visible value that application and optimistic callbacks may mutate. Incoming
patches update that private baseline; complete reconstructed values enter the
existing source-protection boundary. A callback never receives a patch or the
private baseline itself.

While one or more associated operations remain pending, patches continue to be
processed privately so subsequent patches have the right baseline. Protection
retains only the newest reconstructed value, not a queue of patch operations.
Normal `reconcile` or rollback runs first; existing mutation acknowledgement
checks still determine when a buffered value is eligible to become visible.
This applies equally to one source, multiple sources, and sources shared by
different optimistic helpers. Requests remain concurrent and grouping IDs keep
their existing meaning. There is no optimistic overlay or callback replay.

An unchanged result must still deliver its updated confirmation cursor. It can
use an empty patch when smaller, but cannot silently omit that acknowledgement:
an older buffered value must not overwrite reconciliation or leave confirmation
waiting indefinitely.

### Baselines, recovery, and failures

Patch frames identify their expected baseline and next connection-local sequence.
These positions describe transport reconstruction, separately from the existing
invalidation cursors used for optimistic confirmation. They are not database
versions and do not establish database write order.

The client applies operations without mutating its previous baseline; malformed
operations cannot partially update displayed data. Paths use own properties,
validate array indices and escapes, and do not traverse inherited prototypes.
Operation and path-depth bounds are enforced on receipt as well.

A missing or mismatched baseline cancels that reader and automatically opens a
new live GET connection, retaining the last displayed value until a fresh full
snapshot arrives. Recovery is bounded: repeated mismatches without a successfully
applied patch or subsequent consecutive full snapshot become terminal rather
than causing a reconnect loop. Malformed operations, invalid sequences, invalid
JSON, and authorization/query failures remain terminal; `$track(source).error`
reports them and explicit `refresh()` can retry. Ordinary transient network
failures retain the existing bounded reconnect backoff. Unmount, abort, and
argument changes still close the owned connection.

SSR and `$routed` preparation remain finite snapshots. Hydration opens a live
connection with a fresh full baseline; it never patches against an SSR payload
that application code might already have changed. Async generators retain their
complete-yield protocol, and mutation generators are never restarted to recover
a patch baseline. No automatic browser GET follows a successful mutation in the
normal case; reconnect and baseline recovery are explicit exceptions.

### What this does not optimize

Patches reduce wire payload size, not query execution time. The server still
performs its read, JSON normalization, and bounded comparison. Avoiding redundant
snapshot serialization/encoding does not remove those full-value costs, and the
diff work budget does not bound query time or serialization cost. Private baselines
and detached visible values also have memory/copying costs; this is not a promise
of lower CPU or rendering cost. Each connection still owns its query evaluation,
baseline, and encoding work. Costs therefore grow with subscribers and result
size; identical invalidation keys do not establish identical authorization and
never automatically opt subscribers into shared computed results.
Initial snapshots still need to fit the existing
1 MiB per-frame client limit. Independent sources still do not update atomically,
and invalidations remain application-instance-local. The Fieldnotes example's
artificial query/mutation delays remain unchanged.

## Reporting stream failures on the server

Failures while evaluating a live query, advancing a generator, or encoding its
frames reach the existing `serve({ onError(error, context) })` handler with the
original exception and the subscriber's request context. This includes failures
before the first frame and after earlier values were delivered. The returned
stream response is already selected: the handler can log/report the failure but
cannot replace its HTTP status, headers, or body. Its replacement response body
is cancelled instead of leaked. The browser receives only the generic terminal
`Live query failed` or `Streaming function failed` message, never private details
or a stack trace.

When no `onError` is configured, stream failures are logged server-side with the
request method/path and original exception. A throwing/rejected reporting hook
logs both failures and still permits stream termination and cleanup. Error
reporting runs independently of failure delivery and subscription cleanup, so a
slow asynchronous hook does not hold the failed stream open. Ordinary
request cancellation is not logged as a query failure. This uses the existing
application error hook; there is no separate stream-specific configuration API.
