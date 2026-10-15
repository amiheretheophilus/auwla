# Server-owned components through `page(...)`

Status: implemented first version. The Vite adapter links server-function JSX
to the existing server renderer and initial browser-binding compiler. Finite
GETs, mutations, live GETs, forms, and supported local interactions work without
a second component language.

`page(JSX)` describes a server-rendered result, not a document, route, or
subscription. It accepts a subtree or fragment. It does not navigate, select a
DOM target, or require SSE.

## Configuration and server authoring

Keep the existing `createDefine()`, `serve()`, and Vite configuration. Re-export
the helper from the shared definition module if desired:

```ts
// server/define.ts
import { createDefine } from '@memoized-dom/server';
export { page } from '@memoized-dom/server';

export const define = createDefine<{
  user?: { id: string };
}>();
```

Functions remain in the configured server root's `functions` directory. Load
data and perform authorization in the handler, then return JSX:

```tsx
// server/functions/expedition-page.tsx
import { define, page } from '../define';
import { ExpeditionBoard } from '../components/ExpeditionBoard';
import { AccessDenied } from '../components/AccessDenied';

export const getExpeditionPage = define.function({
  async get({ services, state }, expeditionId: string) {
    if (!state.user) {
      return page(<AccessDenied reason="Please sign in" />);
    }

    const notes = await services.notes.all(expeditionId);
    return page(<ExpeditionBoard expeditionId={expeditionId} notes={notes} />);
  },

  live: (_context, expeditionId) => ['expedition-notes', expeditionId],
});
```

`state.user` is ordinary injected request state. JSX props retain their normal
type-checking. No render-result type import is needed. The handler, services,
and selected server rendering implementation stay on the server.

Components can live under the server root or in an ordinary shared UI directory.
Imports needed by local browser interactions must still be browser-safe. Server
placement alone does not make a captured service or secret safe to transfer.

## Browser usage

Import the generated function and interpolate its result directly:

```tsx
import { getExpeditionPage } from '#server-functions';
import { Group } from '@memoized-dom/data';
import type { ErrorPolicyComponentProps } from '@memoized-dom/data';

function Loading() {
  return <p>Loading expedition…</p>;
}

function Failed({ error, retry }: ErrorPolicyComponentProps) {
  return <p>{error.message} <button onClick={retry}>Retry</button></p>;
}

export function ExpeditionScreen({ expeditionId }: { expeditionId: string }) {
  const board = getExpeditionPage(expeditionId);

  return (
    <Group pending={Loading} error={Failed}>
      <main suspend>{board}</main>
    </Group>
  );
}
```

There is no authored SSE endpoint, message parser, mounting wrapper, or manual
HTML insertion. Generated source readiness includes loading its allowlisted
binding module. `Group` and `suspend` handle pending/error presentation; a failed
binding load is a source failure, not a silently noninteractive page.

The result is a remote renderable value, not a browser `Node` or application
data to mutate. Consume the generated source directly. In this first version,
do not serialize it through arbitrary JSON caches, `routeState`, or a
`$routed` result: those paths do not carry the generated page transport's
render authorization. An ordinary route component can use the direct source
shown above.

## Finite GETs and mutations

Omit `live` for a finite GET. Both finite GETs and mutations deliver one HTML result
through the normal HTTP response; they do not open SSE connections.

```tsx
export const archiveExpedition = define.function({
  async post({ services }, expeditionId: string) {
    const expedition = await services.expeditions.archive(expeditionId);
    return page(
      <section>
        <h2>{expedition.name}</h2>
        <p>Archived</p>
      </section>
    );
  },

  updates: (_context, expeditionId) => ['expeditions', expeditionId],
});
```

The caller chooses the target by assignment:

```tsx
// Assume this getExpeditionPage has no live declaration.
let board = getExpeditionPage(expeditionId);

function archive() {
  board = archiveExpedition(expeditionId);
}

return (
  <main>
    <div suspend>{board}</div>
    <button onClick={archive}>Archive</button>
  </main>
);
```

The POST executes once. Rendering its result does not repeat the mutation or
require a follow-up GET. Optional `updates` invalidates independent live
subscribers after success.

Assigning a different source replaces the old source's ownership. An old live
subscription is released when it has no remaining consumers. Assignment does
not secretly keep that subscription connected to the new finite result. Other
viewers with their own live sources remain subscribed.

## Forms

Use existing `$forms`, not a second form API. For example, given a
`saveExpedition(expeditionId, title)` mutation that returns `page(...)`:

```tsx
let board = getExpeditionPage(expeditionId);
const form = $forms((fields: FormData) => {
  const result = saveExpedition(expeditionId, String(fields.get('title') ?? ''));
  board = result;
  return result;
});

return (
  <main>
    <div suspend>{board}</div>
    <form onSubmit={form.submit}>
      <input name="title" />
      <button disabled={form.pending}>
        {form.pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  </main>
);
```

Return the server-function result so the form owns its submission lifecycle.
Validation is optional and uses the existing form/server-function facilities.
On first load, `Group`/`suspend` shows its pending policy until there is content.
After a page has committed, assigning a new pending request keeps the old page
visible and interactive until the replacement value and its binding module are
ready. The form still reports `pending`; the new request does not pretend to
contain the old data. Overlapping assignments display only the current source's
result, and replacement failures still use the existing error policy.

This is automatic source presentation, not a second form or page API. The same
behavior applies to ordinary data sources under these boundaries. Explicit
authored conditions such as `form.pending ? <Loading /> : ...` still mean what
they say. Retention ends when the boundary unmounts or its error policy takes
over. Retaining content during the wait does not guarantee identity after commit.

## Live updates and connections

With `live`, matching invalidations rerun the GET and deliver its new rendered
result. Key callbacks receive context first, followed by the same positional
arguments as the handler:

```ts
export const postNote = define.function({
  async post({ services }, expeditionId: string, text: string) {
    return services.notes.add(expeditionId, text);
  },

  updates: (_context, expeditionId, _text) =>
    ['expedition-notes', expeditionId],
});
```

The source retains the existing stale-read checks: an invalidation during data
loading or rendering discards that obsolete result and reruns the GET before
delivery. Cancellation and subscription cleanup follow existing source ownership.

One distinct active live source owns one streaming request. Nested components
do not open their own connections. Equivalent requests can share the existing
data resource within one runtime under its normal cache policy; disabling
caching bypasses that sharing. Equal invalidation keys do not merge different
queries into a connection. App-wide SSE multiplexing is not implemented.

**Live does not mean globally shared UI.** A key selects which queries to rerun;
each subscriber's handler renders using its own request context. Two private
inboxes can use the same key and still return different authorized results,
although both rerun unnecessarily. Matching user-scoped `live`/`updates` keys
avoid unrelated reads; handlers, not keys, enforce privacy. Collaboration needs
shared underlying server data as well as matching invalidations. Browser-local
state stays local. See the step-by-step
[Alice/Bob example and key-scoping guidance](./live-streaming-design.md#same-keys-private-data-and-collaboration).

Live updates do not preserve server component instances between requests.
Request state remains request-scoped. Persistent application state belongs in
appropriately scoped services/storage. Invalidation is explicit, not automatic
database observation, and coordination is still instance-local. See
[live queries](./live-streaming-design.md) and the
[adapter discussion](./live-adapters-discussion.md).

## Local interactivity

Use ordinary JSX, local variables, and events; no `"use client"` directive or
separate island syntax:

```tsx
export function ExpeditionBoard({ expeditionId, notes }: {
  expeditionId: string;
  notes: readonly { id: string; text: string }[];
}) {
  let expanded = false;

  async function toggle() {
    await Promise.resolve();
    expanded = !expanded;
  }

  return (
    <section>
      <h2>Expedition {expeditionId}</h2>
      <button onClick={toggle}>Toggle notes</button>
      <ul if={expanded}>
        {notes.map(note => <li key={note.id}>{note.text}</li>)}
      </ul>
    </section>
  );
}
```

The server produces the initial HTML. The browser attaches the compiler's
supported initial bindings and carries out local events, including async
continuations. It does not rerun the server-owned component's rendering program
to reconstruct that HTML. Local toggles need no server round trip. Defined
server functions remain the boundary for server mutations; arbitrary captured
server closures are not RPCs.

Interactive pages must satisfy the existing initial-binding compiler proof.
Unsupported interactive setup fails compilation instead of discarding handlers
or falling back to full component rendering in the browser. In particular,
load initial request data in the server handler before returning JSX, rather
than starting a setup-time request inside an interactive page component.
Noninteractive pages can settle supported render-time requests on the server.

A passive page sends no component binding program, although the shared source
transport and containing application still need their normal browser runtime.

## Update identity and cleanup

When a page stays mounted and receives the same page call-site identity and
binding contract, the runtime updates its projected inputs through those
bindings. Tested compatible live updates retain local state, an uncontrolled
input's node/value, and focus. Repeated regions have isolated runtime owners.

A different page call site or binding contract replaces the region and disposes
its bindings. Passive HTML results replace their region when the new result is
ready. Assigning a new pending request retains the committed page during the
wait. A compatible completed result then updates its existing bindings; an
incompatible one replaces the region at commit, not at request start.
JSX `key` is not a promise of identity across these replacements. General
focus/selection preservation across arbitrary replacements and a separate
"apply action UI while retaining this live target" operation are not provided.

## CSS and the transfer boundary

TSRX scoped styles accompany the result and are owned by its region.
External CSS imports go through Vite's normal CSS pipeline. The current
region-owned scoped-style path uses inline style elements without a nonce
option; use external CSS when a strict CSP disallows those inline styles.

Only compiler-selected input paths needed by browser bindings cross the
boundary. Reading `user.name` does not transfer unused `user.password`.
Arrays retain their row structure; optional `undefined` inputs preserve their
meaning through the JSON wire format.

Whole-object/function captures, service/class instances, getters, unsafe
prototype paths, and unsupported leaf values are rejected rather than
implicitly serialized. Browser-visible rendered text and event inputs are
necessarily public; projection is not permission to put secrets there.
Browser code dependencies must be reviewed as browser code.

The client accepts only generated/verified page transports and known binding
contracts. Ordinary JSON that happens to contain `$mmd: 'page'` remains text,
not executable HTML. No response-selected module URL, `eval`, or JavaScript
source string is executed. Vite rejects client access to private server-page
artifact modules. Development edits to page dependencies trigger a full reload
so stale contracts are not reused.

## What streams today

Without progressive negotiation, finite page GETs and mutations return `text/html; charset=utf-8`, with
`x-mmd-page: 1`. The response body starts with the rendered region, not a JSON
object containing an HTML string. It ends with an inert
`<script type="application/mmd-page+json" data-mmd-page="1">` metadata block
containing the page identity, optional binding inputs, and scoped styles.
Metadata is escaped for HTML embedding and is parsed as data, never executed.
The generated source removes the transport metadata before inserting the region
and waits for its allowlisted binding program. Ordinary `$fetch` HTML reads
still return text; only the generated page transport enables this decoder.

These remain Fetch/XHR requests in browser tools. `text/html` describes the
response body; a Document request means navigation, which this API does not
perform. Error responses keep their normal status and error body. Ordinary
data-returning server functions still return JSON.

Live pages keep `text/event-stream` and the existing SSE snapshot/JSON-patch
transport for their internal page values (HTML plus binding metadata). Finite
SSR snapshot requests use the HTML format above. Changing finite delivery does
not introduce another live protocol. Nested progression is negotiated separately,
as described below.
With negotiated v2 support, compatible interactive page updates may carry a
compact text edit for `/html` alongside binding-input patches, instead of the
complete HTML string. The client reconstructs the exact current HTML before
delivery; it never keeps a stale HTML copy just because the bindings match.
First delivery and reconnects still start full. Passive/incompatible pages use
ordinary replacement/snapshot delivery. Text comparisons are bounded, and an
edit is selected only when smaller. This is a wire-size optimization, not a
field-level DOM diff or a fixed-template assumption: conditional markup can
change without changing the binding key.
A mounted compatible interactive page uses its bindings to update inputs;
passive or incompatible content replaces the owned region.

The existing initial document streaming mode is supported too: the shell may
arrive first and page sources settle later. Restoring such a source waits for
its browser binding module without issuing an unnecessary replacement fetch.

## Colorless progressive page delivery

Generated page sources negotiate progressive delivery automatically. A new
server-owned page can deliver static content and available values first; each
unresolved read uses its nearest `Group` pending policy. Regions fill in as their
data settles, independently of slower siblings. There is no authored generator,
`watch`, streaming component, or connection per section.

For example, a server-rendered component can keep independent reads colorless:

```tsx
export function ExpeditionOverview({ expeditionId }: { expeditionId: string }) {
  const summary = getSummary(expeditionId);
  const notes = getNotes(expeditionId);

  return (
    <article>
      <h2>Expedition overview</h2>
      <Group pending={SummaryLoading} error={SummaryFailed}>
        <section>{summary.description}</section>
      </Group>
      <Group pending={NotesLoading} error={NotesFailed}>
        <ul>{notes.map(note => <li key={note.id}>{note.text}</li>)}</ul>
      </Group>
    </article>
  );
}
```

`getSummary` and `getNotes` above are ordinary generated data-returning server
functions, not generators. `$fetch` and `$read` follow the same consumption
rules. Keep `suspend` when a whole section must become available together; it is
not implicitly applied to the entire remote page. Errors handled by one local
policy do not replace successful siblings. An unhandled render failure fails
the page source and is reported server-side through the existing error hook.

Pending/error markup must be valid at its insertion site. For example, use an
inline `<span>` fallback for reads inside a `<p>`, not another `<p>`. Browser HTML
repair can otherwise move the region anchors and break progressive delivery.
With `<p>{summary.title}: {summary.count}</p>`, the two unresolved reads have
separate placeholders and the static colon is visible. `<p suspend>...</p>`
instead treats that entire paragraph as one unit; another suspended paragraph
can still complete independently. Neither requires suspending the whole page.
Separate placeholders do not create separate requests or readiness: the title
and count read the same summary result and both update when it arrives, without
waiting for an unrelated source. `suspend` is a presentation choice, not a fix
for a source reader incorrectly waiting for another request.

An explicit `await` before `return page(...)` still delays the page: the renderer
cannot stream JSX it has not received. Authorization and middleware run before
selecting/delivering protected content. Keep independent data work in render-time
sources when it should not block the shell.

A finite GET or mutation uses one `text/html` response containing length-framed,
inert HTML page values (`x-mmd-page: 2`), then closes after all regions settle.
The decoder does not execute streamed scripts. `$forms` remains pending until
completion, and the action runs once. Ordinary requests without negotiation and
older clients retain the complete version-1 HTML response. Live pages use their
existing SSE connection for initial progression, then retain the last completed
page during revalidation instead of flashing nested loading UI. Assigning a new
finite source likewise retains the previous page until that replacement is ready.

Each render has a private generation and ordered region records. Records are
cumulative so coalesced deliveries cannot lose an earlier update. Marker lookup
is scoped to the owning page, not the document: two instances of the same page
cannot patch each other. The full current HTML remains available for future
mounts. Comparison work and frame sizes are bounded; this first protocol still
normalizes complete page values rather than providing a token/string append API.

Document SSR can forward a partial page and its later source values without a
duplicate browser fetch. A live page opens its browser subscription after that
initial generation completes. Cancelling a page response releases its server
render and outstanding data reads. Already-dispatched event actions retain their
existing settle-without-replay lifetime.

This does not rerun a server component in the browser. Passive page components
remain server-only; the enclosing application's existing hydration path adopts
their HTML as an opaque region. The page's nested markers belong to that page,
not to the app's hydration index. Supported interactive pages still attach their
compiler-produced binding programs to existing nodes. Streaming a sibling region
must not recreate already-delivered static nodes or erase a native input typed
before hydration.

The existing interactive binding proof is unchanged. Pages whose fixed binding
contract is supported remain interactive and preserve their local state on
compatible updates. Mixed interactive components with render-time async work
that the compiler cannot safely bind still produce the existing compile error;
progressive transport does not bypass that check or ship server closures to the
browser. Broader interactive async binding needs a separate compiler proof.

This differs from the usual SSR handoff: the region keeps server-owned
rendering instead of becoming a fully client-rendered copy of the component.
It is not React's server-component tree protocol: results are owned HTML
regions plus compiled binding inputs, not an RSC component-tree payload.

## First-version boundaries

Supported: direct `page(<Component ... />)`, intrinsic JSX and fragments;
finite GET/POST results; live GET invalidation; direct generated-source
interpolation; existing pending/error/form presentation; passive HTML and
supported interactive initial bindings.

Component tags in extracted JSX must currently be simple imported names.
Same-module component declarations, namespace/member tags, nested `page(...)`,
and generators yielding pages are not linked by this version. Keep a function's
successful results consistently page results rather than mixing ordinary data
and pages. Do not wrap a page in a custom JSON response.

Deferred: native no-JavaScript form/navigation progressive enhancement,
optimistic mutation of rendered UI, app-wide stream multiplexing,
retained-live-target action application, broader interactive async page binding,
and arbitrary server/client closure splitting. Existing data-based
`optimistic()` callbacks are unchanged.

Current stabilization takes priority over progressive enhancement. Direct HTML
delivery is not a no-JavaScript guarantee: `$forms` actions and local handlers
need the browser runtime, and initial document streaming uses inline scripts
to apply late regions. Native form POST fallbacks and a no-JavaScript delivery
strategy have not been selected or implemented. These remain separate from
correct SSR settlement and hydration, which must work in the current model.

Regression coverage includes compiler extraction/projection, independent binding
owners and async handlers, finite/action rendering and stale reads, generated
source restoration, opaque-region hydration, safe JSON handling, CSS, and
Chrome two-tab flows in development, production, and initial document streaming.
