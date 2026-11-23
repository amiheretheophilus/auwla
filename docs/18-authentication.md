# Authentication

Sign-in, sessions and protected pages use pieces you have met already:
cookies on server-function responses, middleware that puts the session in
`state`, `$routed` to keep signed-out visitors off a page, and folder middleware
to keep them away from server functions. Read the session in one place; do not
read the cookie again in every function.

## Declare what a request knows

```ts
// server/define.ts
import { createDefine } from '@memoized-dom/server';

export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
}

export interface RequestState {
  session?: Session;
}

export const define = createDefine<RequestState>();
```

`state` is fresh for every request. Its type reaches middleware, server
functions, routes and `$routed` callbacks through `define`
([server definition](./14-server-config.md)).

## Read the session once, in middleware

```ts
// server/auth/session.ts
import { getCookie } from '@memoized-dom/server';
import { define } from '../define';

export const sessionCookie = 'session';

export const readSession = define.middleware(async (context, next) => {
  const id = getCookie(context.request, sessionCookie);
  context.state.session = id === undefined ? undefined : await context.services.sessions.find(id);
  return next();
});
```

```ts
// server.ts
import { serve } from '@memoized-dom/server';
import { readSession } from './server/auth/session';
import { define } from './server/define';
import { App } from './src/App';

const app = serve({ define });
app.use(readSession);   // every request: pages, $routed, server functions
app.ssr(App);
export default app;
```

Global middleware runs for the server render, for the preparation requests a
browser makes while navigating, and for server functions. A visitor without a
cookie simply has no `state.session`.

## Keep signed-out visitors off a page

A page that needs a session checks it in `$routed`, which runs before the page
renders, on the server for the first load and for each navigation:

```tsx
import { redirectRoute } from '@memoized-dom/router';

export function Workspace() {
  const account = $routed(({ state }) => {
    if (state.session === undefined) return redirectRoute('/login');
    return { name: state.session.name };
  });

  return <main><p>Signed in as {account.name}</p>…</main>;
}
```

Put the check on the layout that holds the protected routes, and every page
under it is covered. Return only what the page shows: the result is sent to
the browser.

## Keep them away from server functions

Folder middleware guards a group of functions
([middleware](./13-server-middleware.md)):

```ts
// server/functions/account/_middleware.ts
import { json } from '@memoized-dom/server';
import { define } from '../../define';

export const middleware = [
  define.middleware((context, next) => context.state.session === undefined
    ? json({ message: 'Sign in to continue.' }, { status: 401 })
    : next()),
];
```

```ts
// server/functions/account/profile.ts
export const getProfile = define.function({
  async get({ state, services }) {
    return services.users.profile(state.session!.userId);
  },
});
```

Keep sign-in and sign-up functions in another folder (`server/functions/auth/`),
outside the guard. The `message` of a 401 becomes the client's error message,
so a form or a `Group` shows it as it is.

## Sign in and out: cookies on the response

A server function can return a `Response`, and `setCookie` adds a cookie to it:

```ts
// server/functions/auth/session.ts
import { deleteCookie, getCookie, json, setCookie } from '@memoized-dom/server';
import { sessionCookie } from '../../auth/session';
import { define } from '../../define';

const cookie = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };

export const signIn = define.function({
  async post({ services }, email: string, password: string) {
    const session = await services.sessions.signIn(email, password);
    if (session === null) return json({ message: 'Email or password is incorrect.' }, { status: 401 });
    const response = json({ name: session.name });
    setCookie(response, sessionCookie, session.id, { ...cookie, maxAge: 60 * 60 * 24 * 7 });
    return response;
  },
});

export const signOut = define.function({
  async post({ request, services }) {
    const id = getCookie(request, sessionCookie);
    if (id !== undefined) await services.sessions.remove(id);
    const response = json({ ok: true });
    deleteCookie(response, sessionCookie, cookie);
    return response;
  },
});
```

| Helper | |
|---|---|
| `getCookie(request, name)` | one cookie's value, or `undefined` |
| `setCookie(response, name, value, options)` | appends a `Set-Cookie`; options `path` (default `/`), `domain`, `maxAge` (seconds), `expires`, `httpOnly`, `secure`, `sameSite` |
| `deleteCookie(response, name, options)` | expires it; pass the same `path` and `domain` it was set with |

On the client, a form submits through `$forms` and moves on with the router,
never `window.location`:

```tsx
import { navigate } from '@memoized-dom/router';
import { signIn } from '#server-functions';

export function LoginPage() {
  let email = '';
  let password = '';
  const form = $forms(async () => {
    await signIn(email, password);
    navigate('/dashboard', { replace: true });
  });

  return <form onSubmit={form.submit}>
    …
    <button type="submit" disabled={form.pending}>Sign in</button>
    {form.errors.length > 0 ? <p role="alert">{form.errors[0]!.message}</p> : null}
  </form>;
}
```

A failed sign-in rejects with the 401's message, which `form.errors` holds.

## Live reads per user

A live read that depends on the user puts the user in its key
([keeping other readers in sync](./12-server-functions.md#keeping-other-readers-in-sync)):

```ts
live: ({ state }) => ['notifications', state.session!.userId],
```

A live connection keeps the context of the request that opened it, so check
access in the handler when it can be revoked while a page stays open.

## Two headers to add yourself, for now

These are not framework defaults yet:

- **Reject cross-site writes.** Session cookies are sent with every request,
  so a mutation should refuse a request from another site:

  ```ts
  // server/functions/_middleware.ts
  import { json } from '@memoized-dom/server';
  import { define } from '../define';

  export const middleware = [
    define.middleware(({ request, url }, next) =>
      request.method !== 'GET' && request.headers.get('Origin') !== url.origin
        ? json({ message: 'Cross-site request refused.' }, { status: 403 })
        : next()),
  ];
  ```

- **Keep per-user responses out of shared caches.** Pages and server functions
  that read the session should not be stored by a proxy or CDN:

  ```ts
  app.use(define.middleware(async ({ url }, next) => {
    const response = await next();
    const html = response.headers.get('Content-Type')?.includes('text/html');
    if (!html && !url.pathname.startsWith('/_fn/') && url.pathname !== '/_memoized/routed') return response;
    // A response's headers can be read-only; copy them into a new one.
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }));
  ```
