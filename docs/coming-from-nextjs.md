# Coming from Next.js

Most of a Next.js app has a direct counterpart here, and the counterpart is
usually less code. The habits that cause trouble are the ones that work around
the framework: navigating with `window.location`, writing `/api` routes for the
app's own data, refetching after every write. Use this page as a map while
porting.

## The map

| In Next.js | Here | Guide |
|---|---|---|
| `useState` | `let count = 0`, written directly | [State](./02-state.md) |
| `useMemo`, derived values | `const total = …` (it follows its inputs) | [State](./02-state.md) |
| `useEffect` to sync derived state | nothing: write the expression | [State](./02-state.md) |
| `useEffect` for a subscription or timer | `$effect(() => { …; return cleanup; })` | [Effects](./03-effects-and-cleanup.md) |
| `useRef` | `ref={element}` | [Refs](./04-refs.md) |
| `app/` folders, layouts | `route="/path"` on elements; a parent route is the layout | [Routing](./07-routing.md) |
| `<Link href>` | `<a route-to="/path">` (checked at compile time) | [Routing](./07-routing.md) |
| `router.push`, `router.replace`, `window.location` | `navigate(path, { params, query, replace })` | [Router API](./08-router-api.md) |
| `usePathname`, `useSearchParams`, `useParams` | `route.pathname`, `route.query`, `route.params` | [Router API](./08-router-api.md) |
| `metadata`, `next/head` | `<head><title>…</title></head>` in the component | [Routing](./07-routing.md#page-titles-head) |
| `app/api/**/route.ts`, `pages/api` | server functions in `server/functions/` | [Server functions](./12-server-functions.md) |
| Server Actions | a server-function mutation, submitted with `$forms` | [Server functions](./12-server-functions.md#pending-and-errors-for-a-mutation) |
| `fetch` in a Server Component, `getServerSideProps` | call a GET server function in the component; the server render includes its data (or streams it in with `mode: 'stream'`) | [SSR](./09-ssr.md) |
| data a page can't render without, auth checks | `$routed(({ params, state, services }) => …)` | [Routed](./16-routed.md) |
| SWR / React Query `useSWR(key, fetcher)` | `const data = getThing(id)` (a GET call is a reactive source) | [Data](./05-data.md) |
| `isLoading`, `error` | `$track(data).pending`, `.error` | [Data](./05-data.md) |
| `<Suspense>`, `loading.tsx`, `error.tsx` | `<Group pending={…} error={…}>` | [Group](./06-group.md) |
| `mutate()`, `revalidatePath`, `router.refresh()` after a write | the mutation's result; `updates`/`live` keys for other readers | [Keeping readers in sync](./12-server-functions.md#keeping-other-readers-in-sync) |
| `middleware.ts` redirecting signed-out users | middleware putting the session in `state`, `$routed` redirecting | [Authentication](./18-authentication.md) |
| `cookies()`, `headers()` | `getCookie(request, name)`, `setCookie(response, …)`, `request.headers` | [Authentication](./18-authentication.md) |
| `process.env` secrets | only under the `server/` folder, which never reaches the browser | [Server functions](./12-server-functions.md) |

## Navigation goes through the router

`window.location.href = '/dashboard'` reloads the whole app;
`history.pushState` changes the URL behind the router's back. Either way
`route`, `$routed` preparations and route code splitting stop working.

```ts
import { navigate } from '@memoized-dom/router';

navigate('/dashboard', { replace: true });                 // after sign-in
navigate('/story/:id', { params: { id } });                // a pattern, checked
navigate('/transactions', { query: { page: 2 }, replace: true });
```

Links are `<a route-to="…">`, never an `onClick` that navigates.

## The app's own data goes through server functions

An `/api/...` route plus a `fetch` on the client is two pieces of untyped code
for one call. A server function is one typed function the client imports from
`#server-functions`; the body stays on the server.

```ts
// server/functions/profile.ts
export const getProfile = define.function({
  async get({ state, services }) {
    return services.users.profile(state.session!.userId);
  },
});
export const updateProfile = define.function({
  async patch({ state, services }, changes: ProfileChanges) {
    return services.users.update(state.session!.userId, changes);
  },
});
```

```tsx
import { getProfile, updateProfile } from '#server-functions';

const profile = getProfile();                 // a source: render it, $track it
const save = $forms(() => updateProfile({ name }));
```

Raw routes (`app.get`, `app.post` in `server.ts`) remain for what is not a call
from your own UI: webhooks, OAuth callbacks, health checks, and, for now, file
uploads (server-function arguments are JSON).

## Don't refetch after a write

In React it is common to call `mutate()` or `router.refresh()` after a write.
Here, a mutation returns the server's truth for what it changed: put it into
the data you already hold. When other components or tabs show the same data,
declare `updates` on the mutation and `live` on the reads, and the server pushes
the new values to every reader. Call `$track(source).refresh()` only for a value
nobody else reads and you can't compute locally.
[Keeping other readers in sync](./12-server-functions.md#keeping-other-readers-in-sync).

## Forms submit through `$forms`

A Server Action's pending state and errors come from `useFormStatus` and
`useActionState`. Here, `$forms(action)` gives `form.pending`, `form.errors` and
`form.result` for the latest submission; the action can call any server function
and then `navigate`. An expected failure is a server-function `Response` with a
`message` (`json({ message }, { status: 400 })`), which becomes
`form.errors[0].message`. You don't need a `try`/`catch` to show it.

## Loading states belong to a `Group`

Instead of `isLoading ? <Spinner/> : …` in every component, wrap the region in
`<Group pending={Spinner} error={Failed}>`: everything inside that reads a source
waits together. For secondary data that should not hold the page up (a badge,
a user's name in a menu), read it with a fallback:
[Secondary data](./05-data.md#secondary-data-a-fallback-instead-of-waiting).

## Patterns worth keeping

- **Filters and search in the URL**: read `route.query`, write with
  `navigate(…, { query, replace: true })`. Reloading or sharing the link keeps
  them. [Routing](./07-routing.md#state-in-the-url-filters-search-pages)
- **A UI preference the server renders** (a collapsed sidebar): store it in a
  cookie and read it with `getCookie(request, …)` in `$routed`, so the first
  render already has it.
- **Validation shared by client and server**: a plain module both import (not
  under `server/`) keeps the rules in one place.
