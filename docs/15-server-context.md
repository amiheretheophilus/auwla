# Server context

Server code receives request context as an argument:

```ts
export const createUser = define.function({
  async post({ request, url, params, state, services, platform }, input: Input) {
    // ...
  },
});
```

The same shape is used by middleware, ordinary routes, server functions, SSR
preparation, and server-backed `$routed` work:

| Field | Lifetime and ownership |
|---|---|
| `request`, `url`, `params` | Current dispatch |
| `state` | Mutable; one fresh object for the current route or server-function dispatch |
| `services` | Shared; one resolved service graph per application |
| `platform` | Current request; host supplied or application fallback |

Middleware can progressively enrich `state`:

```ts
export const authenticated = define.middleware(async (context, next) => {
  context.state.user = await context.services.sessions.read(context.request);
  return next();
});
```

A later middleware or handler in that dispatch sees the same
`context.state.user`. A nested same-origin server-function call during SSR is a
new dispatch and receives a fresh object from `serve({ state })`, just like the
equivalent browser request. Credentials such as cookies and authorization are
forwarded, so middleware reconstructs authenticated state. Parallel child
functions cannot mutate the page request's state or one another's state.

Services remain shared at application scope and platform remains inherited for
the in-memory dispatch. Pass operation input as function arguments rather than
depending on an outer page's temporary state.

The runtime still maintains an internal request scope to implement SSR and
nested dispatch. Application code does not read that scope directly; injected
arguments are the public contract.

Next: [16 — routed preparation](./16-routed.md)
