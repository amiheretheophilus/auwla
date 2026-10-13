# `serve()` — application composition

Create one typed definition object for the server, then pass that exact object
to `serve()`:

```ts
// server/define.ts
import { createDefine } from '@memoized-dom/server';

export const define = createDefine<{
  requestId: string;
  user?: User;
}, Platform>();
```

```ts
// server.ts
import { serve } from '@memoized-dom/server';
import { define } from './server/define';

const app = serve({
  define,
  state: () => ({
    requestId: crypto.randomUUID(),
    user: undefined,
  }),
  platform: request => developmentPlatform(request),
  render: { mode: 'resolve', timeout: 2_000 },
  onError(error, { state }) {
    console.error(state.requestId, error);
    return new Response('Internal error', { status: 500 });
  },
});

export default app;
```

`state` runs once for each incoming request. The same mutable object then flows
through global middleware, path middleware, routes, server functions, SSR, and
nested in-memory dispatch for that request. A different request gets a
different object.

`platform` is a per-request fallback. A host can override it when dispatching:

```ts
app.fetch(request, { platform: hostBindings });
```

The remaining application methods stay on the value returned by `serve()`:

```ts
app.use(logger);
app.get('/api/health', () => ({ ok: true }));
app.ssr(Main);
```

`define` owns the shared type contract and declarations. `serve()` owns
request construction, routing, rendering, errors, and host dispatch.




## The host boundary

`app.fetch(request, options?)` returns a `Promise<Response>`. Dispatch options
can supply `platform`, `state`, and `services` for that request. For example,
Hono on Bun or Node can delegate after its own routes:

```ts
backend.all('*', c => app.fetch(c.req.raw, { platform: c.env }));
export default backend;
```

Direct exports receive the native host context automatically:

| Host | `context.platform` |
|---|---|
| Bun | the actual `Bun.Server` |
| Node | `{ incoming, outgoing }` native HTTP objects |
| Cloudflare | `{ env, executionCtx }` Worker bindings and execution context |

For Hono on Cloudflare, delegate with
`{ platform: { env: c.env, executionCtx: c.executionCtx } }`. The same context
reaches middleware, SSR, route preparation, and generated server functions.

The fullstack build installs the frontend document, generated functions, and
asset delivery at `serve()` import sites. Users do not add static middleware
or import host adapters in the server entry. Native builds bundle those
generated helpers. See [09 — SSR](./09-ssr.md#development-and-production)
for the normal `vite.config.ts`, runtime selection, commands, and hot updates.


## `render` and `onRender` — how pages render and how they went

`render` sets application-wide SSR defaults; each `app.ssr()` call can
override them for its root:

```ts
const app = serve({
  define,
  render: { mode: 'resolve', timeout: 2_000, deadline: 8_000 },
  onRender: (report) => metrics.record(report.outcome, report.durationMs),
});

app.ssr('/', Landing, { mode: 'shell' });            // paint now, data client-side
app.ssr('/account/*', Account);                      // resolved data, streamed
app.ssr('/docs/*', Docs, { delivery: 'buffer' });    // complete document, Server-Timing
app.ssr('/feed', Feed, {                             // shell now, regions as they settle
  mode: 'stream',
  nonce: request => request.headers.get('x-csp-nonce') ?? undefined,
});
```

| Option | Default | Meaning |
|---|---|---|
| `mode` | `'resolve'` | `resolve` waits for request data; `shell` serializes pending UI immediately; `stream` sends the shell, then each region as its data settles ([09 — SSR](./09-ssr.md#streaming-regions)) |
| `timeout` | `10000` | soft data budget — when it elapses, pending UI is rendered (`stream`: the browser fetches what is left) |
| `deadline` | none | hard budget for the whole render, route preparation included |
| `markers` | `true` | hydration markers and payload; `false` for HTML that never hydrates |
| `delivery` | `'stream'` | `stream` or `buffer` (below) |
| `nonce` | none | `(request) => string \| undefined`: CSP nonce for the inline scripts `mode: 'stream'` sends |

With `stream`, the response commits as soon as route preparation has decided
it — authentication gates and `redirectRoute()` still become real redirects —
and the document head is sent immediately while the application renders. In
`resolve` mode the application body is atomic: its markup and payload are
sent together once the render succeeds. In `mode: 'stream'` the shell follows
right away and each region follows when its data settles. A `buffer`
delivery settles a `stream`-mode render like `resolve`. If it fails after the response committed (for example, the
`deadline` passes), the document closes with an empty outlet and `mount()`
renders the page client-side, so users get a working page and never a
half-adopted one. With `buffer`, nothing is sent until the whole document is
ready, so every failure still reaches `onError`.

`onRender` receives one report per page: `outcome` is `complete`, `timeout`
(data budget elapsed), `shell`, `redirect`, `deadline`, `aborted` (client
disconnected), or `error`, plus `durationMs` and, for resolved renders,
`settleMs`.


Next: [11 — Server routing](./11-server-routing.md)
