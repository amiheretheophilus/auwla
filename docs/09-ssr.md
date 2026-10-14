# SSR — rendering on the server

So far `mount` builds all the DOM in the browser. SSR flips the order: the
server runs your component first and sends real HTML, so the page paints
before JavaScript loads. `mount` then *adopts* that markup — no re-render.

## Wire the server entry

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [
    memoizedDom({
      clientEntry: 'src/main.ts',
      serverEntry: 'server.ts',   // one new line
      runtime: 'bun',
    }),
  ],
});
```

`serverEntry` is the server composition root. Default-export either a `serve()`
application or a backend with a Web-standard `fetch` handler, such as Hono.
The native host owns the listener and its APIs; `serve()` owns application
routes, middleware, and SSR. Vite supplies compilation and hot updates.

SSR also needs an outlet in `index.html`, inside the element passed to
`mount`:

```html
<div id="root"><!--ssr-outlet--></div>
<script type="module" src="/src/main.ts"></script>
```

The server replaces the single `<!--ssr-outlet-->` marker with rendered
markup. The browser-only starter template in [01 — Start](./01-start.md)
does not need it; add it when enabling SSR. A missing or duplicate marker
is a template error.

## Minimal server

```ts
// server.ts
import { createDefine, serve } from '@memoized-dom/server';
import { App } from './src/App';

const define = createDefine();
const app = serve({ define });

app.ssr(App);            // server-render on every page request

export default app;
```

The entry needs `serve()`, one `ssr` call, and a default export. Page requests
receive rendered HTML plus a hydration payload; generated assets are served
separately. `src/main.ts` doesn't change:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);   // detects the server markup and hydrates
```

## Development and production

See the [CLI guide](./cli.md) for commands, flags, and runtime selection.

Keep the same development and build commands as the browser-only application.
For a Bun production target, add its start command:

```json
{
  "scripts": {
    "dev": "memoized-dom dev",
    "build": "memoized-dom build",
    "start": "bun dist/server.js"
  }
}
```

These commands read the normal `vite.config.ts`. The CLI selects the development
host from `runtime` in the plugin configuration; Bun is the default for a server
application. With `runtime: 'bun'`, development runs transformed server modules
inside Bun and starts a native Bun listener. Bun APIs and the
actual server remain available. A private loopback Vite listener supplies
frontend modules, styles, and browser HMR. Set `server.port` in `vite.config.ts`
or pass `--port` to the launcher to change the public port (default 3000).

Backend, SSR component, and server-function edits replace the application
without restarting the public listener. Browser component HMR updates the
mounted page; component-local state can reset. On Bun and Node, an optional
named `dispose()` export releases application services after the old
generation's response streams finish. Restart after changing native listener
options or WebSocket callbacks.

The build compiles the client first into `dist/client`, then emits the backend
in `dist/server.js`. It installs the built HTML document, generated server
functions, and asset delivery automatically, including when the application
is mounted inside Hono. API routes take precedence over frontend delivery.
No static middleware, manifest loading, or authored asset handler is needed.
You do not import a Bun or Node adapter in `server.ts`: the generated host
helpers are bundled into the server output. Keep the server and backend
packages your own entry imports as production dependencies.

For Node, select `runtime: 'node'` and use `memoized-dom dev`,
`memoized-dom build`, and `node dist/server.js`. The launcher runs in Node
by default; the package's Node engine requirement applies. Bun/Node development
uses the launching runtime, while `runtime` selects the production target.

## Using Hono in the same entry

Hono can own backend routes and delegate remaining requests to Memoized DOM:

```ts
// server.ts (Bun or Node)
import { Hono } from 'hono';
import { createDefine, serve } from '@memoized-dom/server';
import { App } from './src/App';

const define = createDefine();
const app = serve({ define });
app.ssr(App);
const backend = new Hono();
backend.get('/api/users', c => c.json([]));
backend.all('*', c => app.fetch(c.req.raw, { platform: c.env }));
export default backend;
```

The launcher receives that export and starts the selected native host. The
entry needs no separate `Bun.serve()` call. Other backends can use the same
boundary if they expose a Web-standard `fetch` handler and support the runtime.

## Cloudflare Workers

Install `@cloudflare/vite-plugin` and `wrangler` as development dependencies.
Use the normal `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';
import { cloudflare } from '@memoized-dom/vite/cloudflare';

export default defineConfig({
  plugins: [
    memoizedDom({
      clientEntry: 'src/main.ts', serverEntry: 'server.ts', runtime: 'cloudflare',
    }),
    cloudflare(),
  ],
});
```

Keep the Worker name, compatibility date, secrets, and bindings in the normal
Wrangler configuration. `cloudflare()` wraps Cloudflare's official Vite
integration, runs server modules inside `workerd`, enables Node compatibility
for request context, and configures the asset binding automatically. The
configured server entry supplies `main` when Wrangler omits it.

A directly exported `serve()` application receives `{ env, executionCtx }`
as `context.platform`. Hono retains its normal `export default backend`;
forward its bindings when delegating:

```ts
backend.all('*', c => app.fetch(c.req.raw, {
  platform: { env: c.env, executionCtx: c.executionCtx },
}));
export default backend;
```

Native Worker objects with `fetch(request, env, executionCtx)` also work, and
their additional Worker handlers remain on the export. Backend dependencies
must support Workers; Bun APIs are available only on the Bun host.

Run `memoized-dom dev` and `memoized-dom build` with Node. Use `vite preview`
for the built Worker locally and `wrangler deploy` to deploy it. The same
backend entry runs in development and production, with automatic SSR and
client assets. Server, SSR, server-function, and browser hot updates use the
Worker runtime integration. No special Vite config filename is required.

The hydration runtime is an opt-in bundle feature, so non-SSR applications
never ship it. The Vite plugin installs it automatically for client entries
when `serverEntry` is configured. Outside the plugin, add one import to the
client entry:

```ts
import '@memoized-dom/runtime/hydrate';
```

If server markup is found without the hydration runtime installed, `mount`
logs a warning and falls back to a fresh client mount — the page still
works, it just rebuilds the DOM.

## SSR only some paths

`app.ssr(path, component)` renders a component only for requests matching
a route pattern:

```ts
app.ssr('/about', AboutPage);
app.ssr('/docs/:page', DocsPage);   // params work like route patterns
app.ssr('/blog/*', BlogSection);    // terminal wildcard too
```

Matching requests get server HTML; everything else falls through to the
normal client-rendered index. Use it to SSR landing/docs pages while the
app proper stays client-only, or to mount different roots per section.
You can mix: `app.ssr(App)` as the catch-all plus targeted entries.

## Streaming regions

By default the server waits for request data and sends the page body once
(`mode: 'resolve'`). With `mode: 'stream'` it sends the shell immediately and
then each loading region as soon as *its* data settles, in whatever order
that happens:

```ts
app.ssr(App, { mode: 'stream', nonce: request => request.headers.get('x-csp-nonce') ?? undefined });
```

- **What streams.** Every data read the compiler sees sits in its own region,
  so nothing needs annotating. Wrap slow UI in a `Group` with a `pending`
  skeleton to choose what shows while it loads; a read outside a `Group` shows
  nothing until its data arrives.
- **Before JavaScript loads** (the usual case, since module scripts run after
  the document finishes): each region arrives as a `<template>` plus its data,
  and a small inline script swaps it into place. The page fills in without
  the app bundle, and `mount()` then adopts the finished regions without
  fetching anything again.
- **After `mount()`**: the mounted app owns its DOM, so late regions are
  delivered to it as data and the waiting `Group` renders normally.
- **Not delivered** (the `timeout` budget elapsed, or the connection
  dropped): the browser fetches those sources itself once the page has
  loaded.
- **`nonce`** is only needed with a strict Content Security Policy; without it
  the inline scripts would be blocked. Return the same nonce your CSP header
  uses for that request.
- **Without JavaScript** visitors and crawlers see the skeletons, because the
  swap needs the inline script. Keep `resolve` for pages that must be
  complete without JavaScript.
- `$routed` data is still awaited before anything is sent: it decides
  redirects and status codes.

Buffered delivery waits for a `stream` render's data like `resolve`.

## What `mount` does with server markup

`mount(target, component, options?)` has these paths:

1. **Server markup present** (the `data-mmd-root` marker matches the
   component) → **hydrate**: adopt existing nodes, attach handlers,
   restore the embedded payload. Nothing is rebuilt.
2. **No server markup** → plain client mount, same as always.
3. **One region doesn't match** (inside a `Group` or another data region) →
   only that region is discarded and rendered on the client; the rest of the
   page keeps its server DOM, focus and scroll. This absorbs, for example, a
   browser extension that rewrote part of a list.
4. **Markup outside any region doesn't match** (including a different
   compiled root) → the server DOM is discarded (`host.innerHTML = ''`) and
   the app mounts fresh client-side.

Neither recovery crashes, but both cost a client render of the affected
part, so treat mismatches as bugs to fix, not a fallback to rely on.

To see mismatches that would otherwise recover silently, pass a callback:

```ts
mount('root', App, {
  onHydrateError(error, scope) {
    console.error(`[HYDRATION-MISMATCH:${scope}]`, error.message);
  },
});
```

The callback receives a `HydrationMismatchError`, with `boundary`,
`expected`, and `actual` fields, and the recovery `scope`: `'region'` after a
region re-rendered itself (reported once adoption finishes), or `'root'`
before the whole root is replaced. It is not called for an ordinary client
mount or successful hydration. Other rendering errors still throw;
`onHydrateError` is a diagnostic hook, not a general error boundary.

`mount` returns `{ host, rootId, nodes, mounted, unmount() }`.

## Browser JavaScript

Production builds can send static content as HTML with no browser JavaScript.
Interactive content gets the code needed for its events and updates. Pages
that depend on request data still render that data on the server. The framework
handles this automatically; use the same `app.ssr()` and `mount()` calls.

## Server-render rules

- **Same component** in `app.ssr(X)` and `mount('root', X)` — adoption
  keys on the compiled root id; different components can never match.
- **Effects and refs never run on the server** — they first execute
  client-side after hydration. A component that needs the DOM at first
  paint must render everything declaratively.
- **One settle per page** — in `resolve` mode the server resolves
  derivations and data boundaries before serializing the application; only
  `mode: 'stream'` sends regions later (see
  [Streaming regions](#streaming-regions)).
  Async work kicked off by `fetch` in the component body is not awaited — put
  must-render data behind the preparation/data layer, not a fire-and-forget
  call. Delivery, budgets, and shell vs. resolved rendering are configured per
  root (see [10 — `serve()`](./10-serve.md)).
- **Request-owned authored state** — the Vite adapter lowers compiler-tracked
  module state into per-request cells for server renders by default. This
  prevents a write in one render from persisting into the next, including
  writes made through imported helpers. Initial values must be lowerable
  literals; the compiler rejects unsupported initializers. Do not set
  `moduleStateCells: false` for an SSR app with mutable module state.
- **Ordinary server module globals are still process-wide.** Module caches,
  third-party singletons, and server-function implementation variables are
  not automatically per-request. Keep user/session data in request `state`,
  route preparation, or component-owned data, not a mutable server singleton.

Next: [10 — `serve()` configuration](./10-serve.md)
