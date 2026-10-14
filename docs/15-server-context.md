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
| `state` | Mutable; one object for the complete incoming request |
| `services` | Shared; one resolved service graph per application |
| `platform` | Current request; host supplied or application fallback |

Middleware can progressively enrich `state`:

```ts
export const authenticated = define.middleware(async (context, next) => {
  context.state.user = await context.services.sessions.read(context.request);
  return next();
});
```

A later handler sees the same `context.state.user`. Nested same-origin server
function dispatch during SSR also reuses the parent state, services, and
platform, so the request remains isolated without losing middleware work.

The runtime still maintains an internal request scope to implement SSR and
nested dispatch. Application code does not read that scope directly; injected
arguments are the public contract.

Next: [16 — routed preparation](./16-routed.md)
