# Router API

The public surface of `@memoized-dom/router`. `route`/`route-to` attributes
cover the common cases — this is what you reach for when you need the URL in
code, imperative navigation, or navigation lifecycle hooks.

```ts
import {
  route,
  navigate,
  navigateRelative,
  back,
  forward,
  blockNavigation,
  subscribeNavigation,
  redirectRoute,
} from '@memoized-dom/router';
```

## `route` — the current location, reactively

`route` is a reactive snapshot of the active location. Read it in markup or
derivations and it updates on every navigation:

```tsx
import { route } from '@memoized-dom/router';

export function Breadcrumb() {
  return (
    <p>
      {route.pathname} — page {route.query.get('page') ?? '1'}
      {route.params.id !== undefined ? ` (story ${route.params.id})` : ''}
    </p>
  );
}
```

What it carries:

| Field | |
|---|---|
| `pathname` | `/story/42` |
| `params` | merged params of the match chain — `{ id: '42' }` |
| `query` | read-only `URLSearchParams`-like — `.get`, `.getAll`, `.has`, `.size` |
| `search` / `hash` / `href` | raw URL parts |
| `matches` | the ancestor→leaf match chain for nested routes |
| `matched` | the leaf match (`null` when nothing matched) |
| `navigationType` | `'load' \| 'push' \| 'replace' \| 'pop'` — how you got here |
| `state` | history state passed to `navigate` |
| `signal` | `AbortSignal` tied to this location |

## `navigate(pattern, options)` — imperative navigation

```ts
navigate('/about');
navigate('/story/:id', { params: { id: '42' } });
navigate('/story/:id', {
  params: { id: '42' },
  query: { tab: 'comments' },
  hash: 'top',
  replace: true,          // history.replaceState instead of push
  state: { from: 'list' } // lands in route.state
});
```

`params` is **required by the type system** when the pattern has `:param`
segments — you can't navigate to `/story/:id` without an `id`.

`navigateRelative(pattern, { from, ...options })` resolves the destination
against a base path (defaults to the current pathname) — for relative links
in nested layouts.

`back()` / `forward()` — history traversal.

## `blockNavigation(blocker)` — the leave-guard

Register a synchronous guard that runs before any navigation commits:

```ts
let dirty = false;

const stop = blockNavigation(({ to }) => {
  if (dirty && !confirm('Discard unsaved changes?')) return false;
});
// later: stop() removes the guard
```

- Return `false` → navigation is cancelled.
- Return `redirectRoute('/login')` → rerouted instead (chains up to 16).
- Return anything else → allowed through.
- **Sync only** — returning a promise throws; async checks belong in data
  preparation, not the guard.

`redirectRoute(to)` builds the redirect value — also what `$routed`
preparations return to redirect before render.

## `subscribeNavigation(listener)` — lifecycle events

Watch every navigation attempt through its phases:

```ts
const unsubscribe = subscribeNavigation((event) => {
  switch (event.phase) {
    case 'start':    showSpinner(); break;
    case 'prepare':  break;               // running $routed preparations
    case 'redirect': break;               // event.redirect — where it's going
    case 'blocked':  hideSpinner(); break;
    case 'error':
      hideSpinner();
      event.retry?.();                    // re-run failed preparation
      break;
    case 'complete': hideSpinner(); break;
  }
});
```

Each event carries `navigation` (`{ from, to, type }`). This is how you wire
progress bars, analytics, or error toasts around client-side navigation.

## Route code splitting

Imported route components are code-split automatically when the compiler can
prove that their module is needed only by a route. No `lazy()` wrapper or
authored dynamic import is required:

```tsx
import { Detail } from './Detail';

export function App() {
  return (
    <main route="/">
      <section route="/">Home</section>
      <Detail route="/detail" />
    </main>
  );
}
```

In the client build, the compiler replaces the route-exclusive static import
with a route module loader. Vite turns that generated `import()` into a
production JavaScript chunk. If `Detail` imports CSS, that CSS is owned by the
lazy route chunk instead of the entry.

Splitting is module-based rather than component-based. A route component is
eligible when:

- it is imported from another application module;
- every use of that imported binding is a JSX element with `route`;
- its module is not reachable through another eager import path; and
- the compiler is producing the client graph.

The component stays eager when any normal use needs it immediately:

```tsx
import { Detail } from './Detail';

export function App() {
  return (
    <main route="/">
      <Detail route="/detail" />
      <Detail />
    </main>
  );
}
```

The same applies when another eagerly rendered component or value comes from
the route component's module, or when another static import chain reaches that
module. Components declared in the route owner's own file cannot form a
separate module chunk.

One route does not necessarily mean one emitted file. Routes from the same
module share its lazy boundary, and Vite may extract common dependencies into
shared chunks or combine output according to its production graph. Chunk names
and counts are build details, not part of the router API.

### Navigation and loading

Route modules participate in the same preparation pipeline as `$routed` data.
On client navigation, the current route remains committed until the destination
module and its route preparations are ready. A failed module load leaves the
current route in place and publishes an `error` navigation event; its `retry()`
repeats the destination and the failed module load.

Matched routes prepare from parent to child. A parent redirect or failure can
therefore stop navigation before a lazy child module is requested. Successfully
loaded modules are reused by later visits, while each newly mounted component
still receives a new component instance.

There is currently no automatic link prefetching. A lazy route begins loading
when navigation or initial-route preparation needs it.

### Initial loads and SSR

Automatic route splitting is a client delivery optimization. Server compiler
output keeps route component imports eager so the requested route can be
rendered synchronously during SSR.

For a direct visit to a lazy route, the server renders the matched component's
HTML, then the browser loads that route's client chunk before mounting or
adopting the rendered DOM. A completely static page, or a server-rendered page
with no browser behavior, may emit no client JavaScript at all.

Normal authored `import()` expressions still use Vite's ordinary code
splitting. They are separate from automatic route splitting and make hydration
planning conservative because the compiler cannot know all structure that the
future module may create.

## Quick reference

| Need | API |
|---|---|
| Read URL/params/query reactively | `route` |
| Go somewhere from code | `navigate(pattern, { params, query, hash, replace, state })` |
| Relative link | `navigateRelative(pattern, { from })` |
| History | `back()`, `forward()` |
| Unsaved-changes guard | `blockNavigation` → `false` / `redirectRoute` |
| Progress/error hooks | `subscribeNavigation` phases |

### Lower-level helpers (you probably don't need)

`buildRoutePath`, `normalizeRoutePath`, `resolveRoutePath`,
`joinRoutePaths`, `matchRoutePattern`, `createRouteMatcher`,
`createRouteManifest`, `parseRouteQuery`, `createRouteQuery`,
`validateRoutePattern(s)`, `compareRoutePatterns`, `rankRoutePattern`,
`createMemoryRouteHistory`, `createRouteRuntime`, `getActiveRouteRuntime` —
the building blocks the compiler emits against and tests use; authored app
code rarely touches them.

Next: [09 — SSR](./09-ssr.md)
