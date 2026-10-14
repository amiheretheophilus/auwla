# `$routed` — code that runs when a route matches

`$routed` is a compiler intrinsic available without an import. Router utilities
such as `redirectRoute` still use ordinary imports.

So far, the only way client code reached server code was `#server-functions`.
`$routed` is the other door — and it can do more: a `$routed` callback can
read `services` directly, so server-only work (a database query, the
request's cookies) can back a component without a functions file at all.

```tsx

export function Story() {
  const story = $routed(({ params }) => ({ slug: params.id }));

  return <h1>{story.slug}</h1>;
}
```

`$routed(prepare)` registers a **route preparation**: a function that runs
whenever a matching route is navigated to, before the component renders.
What it returns is what the binding holds — `story` above *is* the object,
not a promise and not a wrapper.

## It must belong to a route

A preparation only runs when its route matches — so a component (or the
file) containing `$routed` must be attached to a `route`:

```tsx
export function Page() {
  return (
    <main>
      <Story route="/story/:id" />   {/* Story's $routed runs on /story/* */}
    </main>
  );
}
```

If the component never sits under a `route`, nothing can ever trigger its
preparation — that's a compile error, not silent dead code
("`$routed` in component 'X' is never prepared…").

## The context — universal fields

The callback receives one context object. These fields work identically
on client and server:

| Field | |
|---|---|
| `url` | the navigation target as `URL` — `url.pathname`, `url.search` |
| `params` | the route's params — `/story/:id` → `{ id }` |
| `query` | read-only query (`query.get('page')`) |
| `signal` | `AbortSignal` — aborted if the user navigates away mid-preparation |
| `routeState` | a mutable bag that **persists across navigations** to this route |

```tsx
const data = $routed(({ params, signal, routeState }) => {
  routeState.visits = (routeState.visits as number ?? 0) + 1;   // survives revisits
  return { id: params.id, visits: routeState.visits };
});
```

`routeState` is per-preparation cache space — stash things between visits
(it's serialized into the SSR payload, so server-prepared cache state arrives
intact on the client).

## The server-only fields — where the door is

Four more fields classify the whole callback as **server-backed**:

| Field | |
|---|---|
| `request` | the incoming `Request` — headers, cookies |
| `state` | per-request data from `serve({ state })` |
| `services` | shared dependencies from declared services — **the db lives here** |
| `platform` | host bindings |

```tsx
export function Story() {
  const story = $routed(({ params, services, state }) => {
    return services.database.stories.findFor(params.id, state.user);
  });

  return <h1>{story.title}</h1>;
}
```

Yes — write it like that. Use `services`, `state`, `request`,
`platform` freely inside `$routed`, even though this component runs in the
browser. **The compiler decides at compile time where the callback runs**:
if it touches server-only fields, the body never ships to the client —
the browser gets a stub, the server executes the real code, and only the
return value crosses the wire. Nothing server-side can leak, and you
don't have to think about it — write the code, the compiler enforces the
boundary.

The one visible consequence: `console.log(services)` in such a callback
prints in your **server terminal**, not the browser console — the code
isn't in the browser.

## Colorless sources and payload caching

`$fetch`, `$read`, and generated GET server functions work inside `$routed`.
The compiler settles preparation-local sources before their payload is read,
derived, returned, or stored in `routeState`. The cached value is application
data, not a resource's internal status object, so it remains usable after SSR
hydration and on later visits:

```tsx
import { getExpeditions } from '#server-functions';

export function ExpeditionList() {
  const expeditions = $routed(({ routeState }) => {
    if (Array.isArray(routeState.expeditions)) return routeState.expeditions;
    const loaded = getExpeditions();
    routeState.expeditions = loaded;
    return loaded;
  });

  return <ul>{expeditions.map(expedition => <li>{expedition.name}</li>)}</ul>;
}
```

Sources created by a preparation are released when it finishes, fails, or is
cancelled. GET still uses the active data cache: another live consumer of the
same request can share its result, but a finished preparation does not retain
an active consumer indefinitely. For reuse across later visits, cache the
payload in `routeState` or use an explicitly app-scoped `$fetch` cache.

Ordinary service methods do not acquire a data cache merely because their
service instance is shared. Calling `services.expeditions.find(id)` runs that
method again unless the service or your preparation explicitly caches it.
Key parameter-dependent `routeState` caches by `params.id`; the state bag is
not automatically partitioned by route parameters.

During SSR and server-backed preparation requests, `$fetch` uses the current
request's data runtime. Same-origin application routes and server functions
dispatch in memory with the current state, services, platform, and credentials;
external destinations use the host fetch implementation.

## Tracking a preparation

A `$routed` result is the same kind of source `$fetch` returns, so it can
be `$track`ed — pending while a navigation prepares it, error if the
callback throws or the server call fails, `refresh()` to re-run it:

```tsx

export function Story() {
  const story = $routed(({ params }) => ({ slug: params.id }));
  const request = $track(story);

  return (
    <div>
      {request.pending ? <p>Preparing…</p> : null}
      {request.error !== null ? <p>{request.error?.message}</p> : null}
      <h1>{story.slug}</h1>
    </div>
  );
}
```

Same tracker shape as everywhere else — `id`, `status`, `onSuccess`,
`onError`, `abort`. Server-backed or not makes no difference to the
tracker; it just sees the source.

### Prepared data is transparent

The value a `$routed` binding holds looks like plain JSON, but it behaves
like `$fetch` data — **writes propagate**. `page.expedition.notes.push(x)`
or `page.count = n` re-renders dependent UI, and mutations made during an
optimistic update or an `onSuccess` reconcile appear immediately:

```ts
tracker.onSuccess((saved) => {
  page.expedition.notes.splice(index, 1, saved);   // UI updates
});
```

That's the boundary worth knowing: values coming *out of* `$routed`,
`$fetch`, or server functions are transparent — reads and writes are both
tracked. A plain object literal you create yourself is ordinary reactive
state under the normal `const`/`let` rules — same outcome, different
origin. The distinction matters mostly when you assume a fetched payload
is frozen/immutable: it isn't — mutating it is the sanctioned way to
reconcile server results locally.

## Redirecting instead of rendering

Return `redirectRoute(...)` and the navigation reroutes — the component
never mounts:

```tsx
const data = $routed(({ state }) => {
  if (state.user === undefined) return redirectRoute('/login');
  return { user: state.user };
});
```

## Rules

- **Attach it to a route** — orphan `$routed` is a compile error.
- **`async`/`await` is fine** — the preparation runtime awaits the returned
  value before the component mounts, so branching on async work reads
  naturally:

  ```ts
  const page = $routed(async ({ params, services }) => {
    const report = await services.reports.find(params.id);
    if (report === null) return redirectRoute('/');
    return { report };
  });
  ```

  Only the *returned* value is settled — a promise nested inside a
  returned object (`{ report: services.reports.find(id) }`) is not
  awaited and won't transport; `await` it first.
- **Server functions work inside `$routed`** — return the call directly
  and the preparation settles the returned source to plain data before
  transport:

  ```ts
  const page = $routed(({ params }) => getReportPage(params.id));
  // page is the settled payload, not a source
  ```

  The settle step sees the returned source, waits for it, and stores its
  data — so a server function can be the whole preparation. You can't
  *inspect* the result inside the callback (it's still in flight there)
  — when you need to branch on loaded data, like a not-found redirect,
  go through `services` and `await` instead. In a server-backed callback
  the call dispatches in-memory on the server; in a universal one it
  goes through the normal `/_fn/*` request — either way the component
  just sees data.
- **Return serializable data** — the result crosses HTTP/SSR boundaries.
  Return `url.pathname`, not the `URL` object; entities, not db handles.
- **Use server fields freely** — the compiler decides per callback where
  it runs; server-only fields mean the callback executes on the server
  and only its return value reaches the client.
- **It's extracted, not a runtime call** — `$routed` is compiler-lowered;
  calling it outside the compiled graph throws.
