# Server-owned components through `page(...)`

Status: authoring design with internal compiler/server foundations started.
`page` is not currently exported, server functions cannot yet deliver this
renderable result to the browser, and the examples below describe the intended
DX rather than runnable current APIs. See the implementation checkpoint below.

## Direction

A server function may return rendered UI instead of ordinary application data.
`page(JSX)` marks the server-owned rendering boundary. It uses ordinary JSX and
the existing component, server-function, and live-invalidation models; it does
not introduce another component language or rendering engine.

The component's rendering stays on the server. The browser receives its rendered
region and any necessary local interaction bindings. It does not rerun the
server-owned component to reconstruct its output from transferred application
data. This is server rendering, but not an automatic handoff of that region to
a client-rendered application after its initial HTML arrives.

Despite its name, `page` accepts a component, fragment, or subtree. It does not
require an entire document and does not implicitly change the URL or register a
route.

## Server authoring

The existing shared definition remains the configuration and typing boundary.
The proposed framework helper can be re-exported from that same module:

```ts
// server/define.ts — proposed page export
import { createDefine } from '@memoized-dom/server';

export { page } from '@memoized-dom/server';

export const define = createDefine<{
  user?: { id: string };
}>();
```

Functions remain under the configured server root's `functions` directory.
Components used to render server-owned content can live under that server root;
ordinary shared components remain usable where their dependencies permit it.

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

    return page(
      <ExpeditionBoard expeditionId={expeditionId} notes={notes} />
    );
  },

  live: (_context, expeditionId) =>
    ['expedition-notes', expeditionId],
});
```

JSX props retain normal compiler JSX type-checking. Authors do not import a new
render-result type, build a transport descriptor, or serialize JSX themselves.
`state.user` uses the existing injected request state, not a new top-level
context field.

## Browser authoring

Import the generated function facade and interpolate its result:

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

The intended result is a compiler-recognized remote renderable source, not an
HTML string or a pretend browser `Node`. Its internal representation must not
become an authoring requirement. Generated declarations and JSX lowering need
to support this distinction; today's DOM-oriented `JSX.Element` type alone does
not establish that contract.

There is no `.html` property, manual DOM insertion, new mounting component,
authored SSE endpoint, message parser, or subscription listener. Reuse existing
`Group`/`suspend` presentation and source-lifetime behavior, including rebinding
when arguments change and releasing work when no consumers remain. Existing
request controls should remain applicable where their lifecycle makes sense;
this does not turn the rendered result into mutable application data.

## Finite reads, mutations, and forms

`page(...)` describes a result, not a subscription. Support finite results from
GET and mutation handlers as a core capability; do not require `live`, SSE, or a
second GET to use server-owned components. Finite results and progressive
delivery are separate concepts: an ordinary response can finish after one page
result, while a live GET remains subscribed to later invalidations.

```tsx
export const archiveExpedition = define.function({
  async post({ services }, expeditionId: string) {
    const expedition = await services.expeditions.archive(expeditionId);
    return page(<ExpeditionBoard expedition={expedition} />);
  },

  updates: (_context, expeditionId) => ['expeditions', expeditionId],
});
```

The caller explicitly chooses where the returned UI appears. Returning a page
does not select a DOM target, navigate, or replace the entire document:

```tsx
// getExpeditionPage is a finite GET in this example: it has no live declaration.
let board = getExpeditionPage(expeditionId);

function archive() {
  board = archiveExpedition(expeditionId);
}
```

The region interpolating `board` receives the mutation result using the same
source/presentation machinery. The POST executes once. Its optional `updates`
callback notifies independent live subscribers after success; neither rendering
its result nor receiving an invalidation may repeat the mutation.

Form actions should use existing `$forms` rather than a second form API:

```tsx
const form = $forms((input: EditExpeditionInput) => {
  const result = saveExpedition(expeditionId, input); // returns page(...)
  board = result;
  return result;
});
```

Here `saveExpedition` is the application's defined mutation, not another
framework helper. The action returns its server-function result so `$forms`
can own validation/submission state. Validation remains optional. That integration
still needs implementation and tests for completion, failure, and result delivery.

A target that already has an active live source needs an explicit ownership
decision. Replacing its source with a finite action result and applying that
result while retaining the original subscription are different operations. Do
not silently promise both, disconnect a retained source, or allow an older live
frame to overwrite the acknowledged action result. The exact retained-live-target
contract remains open; the finite example above does not establish it.

## Live regions

Without `live`, the function delivers a finite renderable result. With `live`,
matching invalidations rerun the server function and deliver updated UI for its
region. Ordinary data-returning functions remain unchanged.

Mutations keep their existing authoring shape:

```ts
export const postNote = define.function({
  async post({ services }, expeditionId: string, text: string) {
    return services.notes.add(expeditionId, text);
  },

  updates: (_context, expeditionId) =>
    ['expedition-notes', expeditionId],
});
```

The handler and key callbacks keep the existing positional argument contract:
injected context first, then the same server arguments in the same order.
See [live queries and streaming functions](./live-streaming-design.md).

The intended flow is:

```text
getExpeditionPage(id) → server renders page(JSX) → browser receives region
mutation succeeds → matching invalidation → server renders again → region updates
```

Rendering again does not mean retaining a persistent component instance on the
server. Local variables must not implicitly become durable session state.
Request state remains request-scoped; persistent application data belongs in
appropriately scoped services or storage. Invalidation is not automatic database
observation, and the current instance-local coordination limitation still applies.

## Streaming and connections

Existing initial HTML streaming sends the shell and then changed HTML regions
as data settles, through one finite document response. It compares serialized
marker-bounded regions; it is not a general field-level HTML patch protocol.
After the client mounts, that existing path delivers late data to the mounted
root rather than replacing client-owned HTML.

The proposed page region instead stays server-owned across live updates. A page
source would own one live streaming request capable of carrying multiple nested
region updates. Nesting components inside `ExpeditionBoard` must not create a
connection per component.

Following the current resource model, distinct active page/data sources can have
separate streams. Equivalent requests can share a resource within the same data
runtime under normal caching; explicit cache disabling bypasses that sharing.
Sharing an invalidation key does not combine distinct sources into one stream.
Application-wide SSE multiplexing is not part of this first implementation.

An `await` before `return page(...)` still delays that returned region. The
example above waits for `notes` before returning the board. A live connection
enables later updates; it does not automatically make that earlier await reveal
nested content progressively. Progressive delivery inside a page must be wired
to supported render-time settlement boundaries, not assumed from the helper.

## Local interactivity and the server boundary

Keep ordinary components and event syntax. Do not require a new `use client`
directive or separate island-authoring syntax for this model. Reuse compiler
analysis and existing HTML-binding machinery to retain necessary browser
behavior without shipping server-owned rendering implementations.

For example, the intended authoring remains ordinary local state and events:

```tsx
export function ExpeditionBoard({ expedition }: {
  expedition: { name: string; description: string };
}) {
  let expanded = false;

  return (
    <section>
      <h2>{expedition.name}</h2>
      <button onClick={() => expanded = !expanded}>Toggle details</button>
      <p if={expanded}>{expedition.description}</p>
    </section>
  );
}
```

The server renders the region. The browser needs the local toggle's bindings
and any values needed for that interaction, not the server's database query or
service instances. Local interactions do not require a server round trip;
server mutations still call defined server functions. This does not grant a
browser handler access to a service merely because the surrounding UI rendered
on the server.

This is an implementation goal, not a claim that arbitrary component code is
already splittable:

- Browser handlers must not capture server services, secrets, or arbitrary
  server-side closures. Unsupported dependencies must produce clear compile
  errors, not leak into browser code.
- Do not silently discard handlers or fall back to executing server-owned
  rendering in the browser.
- Only explicitly needed browser-visible values may cross the boundary;
  rendering with a database object must not implicitly serialize that object.
- Arbitrary server closures do not become remotely callable. Existing defined
  server functions remain the mutation boundary.
- A noninteractive region needs no component rendering program in the browser,
  but live delivery still requires shared browser transport/application code.

## Update ownership and preservation

The server owns the rendered region; any local interaction binding must have a
defined owner within it. We should preserve compatible keyed interactive
regions and their local state, and dispose bindings/effects correctly when
their regions are replaced. Repeated delivery must not duplicate listeners or
retain abandoned resources.

Input values, focus, selection, keyed identity, local state, and cleanup require
explicit semantics and tests. Existing initial-node adoption is useful machinery,
but it does not prove that arbitrary subsequent HTML replacement preserves them.
Do not promise transparent preservation for every replacement or assume that a
JSX `key` already provides identity across streamed render results.

## Reuse and implementation boundaries

The codebase already has separate initial HTML/browser plans, request-only HTML
delivery, supported composition/list/conditional bindings, request-owned render
sessions, initial region streaming, and live query invalidation/transport.
Extend these facilities rather than introduce a second renderer or state model.

The integration work is to:

1. Recognize `page(JSX)` as a render entry within server-function implementations.
   Current initial planning starts from an application `mount()`, and those
   implementation modules bypass normal UI compilation.
2. Produce a renderable server-function result and matching generated client
   types instead of passing it through ordinary data response normalization.
3. Deliver and update server-owned regions beyond the existing initial-document
   handoff, retaining cancellation, stale-result checks, and failure reporting.
4. Adapt binding registration, ownership, and cleanup to newly delivered regions,
   including any required browser code and CSS.

The existing JSON patch protocol patches data values. It is not automatically
an HTML/DOM patch protocol, and its guarantees must not be claimed for remote UI
without implementing and verifying that integration.

## First implementation scope and verification

Start with finite GET and mutation functions returning `page(...)`, optional
live GET updates, existing pending/error presentation and forms, and verified
local interaction bindings. Keep validation optional and ordinary JSON/data
functions unchanged. Subscription machinery must not be a prerequisite for
finite UI results.

Before presenting it as supported, verify finite and live delivery, changing
arguments, independent/repeated regions, branch changes, scoped CSS, disconnect
and unmount cleanup, stale in-flight renders, browser-binding identity, and
server dependency exclusion. Test focus/input/local-state behavior explicitly,
including unsupported capture diagnostics and failures after streaming starts.

Deferred: generator `yield page(...)`, a single multiplexed application stream,
and optimistic mutation of remote rendered UI. Existing data-based optimistic
callbacks remain unchanged. Mixing ordinary data and page results in one
function, the precise UI update encoding, and preservation rules beyond verified
cases need a separate decision; this document does not invent APIs for them.

## Implementation checkpoint

The first internal foundation is implemented, not yet activated in application
delivery:

- `packages/compiler/src/server-pages.ts` extracts imported framework `page(JSX)`
  calls into a private companion UI module. Async handlers stay ordinary server
  code; only the selected JSX is lowered through the existing component compiler.
  Imported aliases and host-resolved helper re-exports are binding-aware, and
  captured values are supplied without copying server handler/service imports
  into that companion module. Imported components remain server dependencies.
- `packages/server/src/page.ts` holds a compiler-created render definition and
  evaluates it through the existing request-isolated renderer. It reuses data
  settlement, cancellation, timeout, escaping, and cleanup rather than creating
  another renderer. Rendering a selected action result does not rerun its action.
- These definitions reject ordinary JSON serialization. An internal render
  product is not a browser-ready interactive result, and must not accidentally
  pass through the existing data response path.

Current extraction supports direct JSX/fragments and imported component tags;
same-module component declarations and nested `page(...)` results are not yet
linked by this extraction path. Interaction syntax is preserved for subsequent
binding compilation, not silently erased.

Still required before the public API becomes usable: Vite companion-module
integration, public helper/result typing, HTTP result normalization, browser
region interpolation and transport, finite action/form integration, live UI
delivery, and interaction binding/ownership. No claim of browser interactivity
or state preservation is established by these internal rendering tests alone.
