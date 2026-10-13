# @memoized-dom/vite

This project does not support legacy APIs. All packages and consumers must use the current APIs. Do not add compatibility shims, deprecated aliases, or fallback paths for superseded APIs.

Vite 8 integration for compiler-linked Memoized DOM applications. One plugin
owns the client compiler graph, server-function facade, and frontend delivery.
The native host owns the public listener. Bun/Node development runs backend
code in the launching runtime; Cloudflare development uses `workerd`. Backend
code has access to the selected host's native APIs and bindings.

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [
    memoizedDom({
      clientEntry: 'src/entry.client.ts',
      serverEntry: 'src/entry.server.ts',
      server: 'src/server',
      runtime: 'bun',
    }),
  ],
});
```

There is no separate fullstack plugin. `serverEntry` tells Vite where the
server graph begins, and `server` identifies the application-owned server
root used for conventions and boundary checks. A client-only application only
needs `clientEntry`.

```ts
memoizedDom({ clientEntry: 'src/main.ts' });
```

The client entry contains the application `mount()` call. The server entry
default-exports the application returned by `serve()`, or a backend such as Hono:

```ts
import { createDefine, serve } from '@memoized-dom/server';
import { App } from './App';

const define = createDefine<{ requestId: string }>();
const app = serve({
  define,
  state: () => ({ requestId: crypto.randomUUID() }),
});

app.get('/api/health', () => ({ ok: true }));
app.ssr(App);

export default app;
```

Hono can own its routes and delegate the remaining requests to Memoized DOM
in the same server entry:

```ts
import { Hono } from 'hono';
import { createDefine, serve } from '@memoized-dom/server';
import { App } from './App';

const define = createDefine();
const app = serve({ define });
app.ssr(App);
const backend = new Hono();
backend.get('/api/users', c => c.json([]));
backend.all('*', c => app.fetch(c.req.raw, { platform: c.env }));
export default backend;
```

The launcher creates the native listener. The user does not need to call
`Bun.serve()` when exporting Hono or `serve()` this way. Bun passes its actual
server as the backend's second fetch argument. Node passes `{ incoming,
outgoing }`. A directly exported `serve()` application receives those values
in `context.platform`; a delegated application receives the platform through
the explicit fetch option shown above.

## Native development and production

```json
{
  "scripts": {
    "dev": "bun run --bun memoized-dom dev",
    "build": "bun run --bun memoized-dom build",
    "start": "bun dist/server.js"
  }
}
```

Development runs backend modules through Vite's ModuleRunner inside Bun.
The public listener handles API requests, SSR, streams, and native WebSocket
upgrades. A separate loopback Vite listener supplies transforms, the document,
styles, and the browser HMR connection. Vite does not dispatch backend routes.
The backend defaults to port 3000; configure `server.port` in Vite's config or
pass `--port` to the launcher. Exported native `port` and `hostname` options
take precedence. Bun exports can also include `websocket`, `error`, and other
supported native listener options.

The build emits client files in `dist/client` and the executable backend in
`dist/server.js`. It installs generated server functions, the built document,
and frontend asset delivery at `serve()` import sites, including applications
mounted inside another router. Users do not install static middleware or load
a manifest. Host adapter helpers are bundled into native server output, so
`server.ts` needs no adapter import and production does not depend on the
Vite development package. Keep packages imported by your authored server
entry as production dependencies. Explicit backend routes run before frontend delivery; API requests
do not prepare the SSR document. Asset delivery permits only files listed by
the client build, supports HEAD, and rejects missing generated chunks. Asset
paths remain relative to the emitted server chunks, so the output can be moved.
Environment-specific build output directories are supported. Use an absolute
path for Vite's `base`, such as `/` or `/app/`.

For Node, launch development with `node` and configure `runtime: 'node'` for
production, then run `node dist/server.js`. Development chooses the runtime
of the launching process; `runtime` selects the production asset reader and
executable host. Node requires the version specified by this package's engines.

## Cloudflare Workers

The backend entry uses the normal Worker export: Hono's `export default backend`,
a Worker object with `fetch(request, env, executionCtx)`, or a directly exported
`serve()` application. Scheduled, queue, and other authored Worker handlers
remain on that export. Backend selection and deployment runtime are independent.

Install `@cloudflare/vite-plugin` and `wrangler` as development dependencies, and
configure the Worker host alongside the compiler in the normal `vite.config.ts`:

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

The `cloudflare()` integration wraps the official Cloudflare Vite plugin. It
reads the normal Wrangler config, assigns the Worker to Vite's `ssr` environment,
enables Node compatibility for request context storage, and configures automatic
asset delivery. The normal Worker name, compatibility date, secrets, KV, D1,
Durable Objects, and other bindings stay in the user's Wrangler configuration.
When `main` is omitted, the configured server entry supplies it. A custom assets
binding name is respected. The binding runs after application routing, and raw
HTML assets do not bypass SSR.

Development executes application modules inside `workerd`; Vite supplies the
transformed modules and browser HMR. Start tooling with Node (`memoized-dom dev`
or `vite dev`). `memoized-dom build` builds the client first, embeds its document
into the Worker, and emits Cloudflare's deployment config. Use `vite preview`
to test the built Worker locally and `wrangler deploy` for deployment. No
`Bun.serve()`, static middleware, or authored asset fetch handler is needed.

Hono keeps native access to `c.env` and `c.executionCtx`. Forward both when
mounting Memoized DOM:

```ts
backend.all('*', c => app.fetch(c.req.raw, {
  platform: { env: c.env, executionCtx: c.executionCtx },
}));
export default backend;
```

A directly exported `serve()` application receives the same
`{ env, executionCtx }` object in `context.platform`. Application code that uses
runtime-specific APIs or native bindings must be appropriate for the selected
host. The framework does not emulate Bun APIs inside Workers.

## Static production HTML

Production HTML entries automatically emit proven closed static applications
into the mount host and omit their entry script. A static Hello page and a
closed composed page ship zero application JavaScript, including runtime code.
Imported and extracted component CSS remains in the build. No authored code is
executed during this proof.

The boundary requires one unconsumed two-argument `mount('id', App)`
entry and an empty `<div id="id"></div>` directly inside the HTML body. Unknown
initializers/imports, refs, effects, unsupported HTML/property semantics,
additional scripts or ambiguous shells retain browser execution.

Production document builds emit one browser graph. The compiler binds the
initial DOM where its shape is proved; creation instructions remain for later
rows, branches and other required browser work. Static composition around an
interactive component adds HTML rather than browser creation instructions.
Aliases and authored source maps are preserved.

Fullstack production builds use the same document planning. A static root
emits no JavaScript assets. An interactive root has one entry that binds its
server HTML, without importing general hydration. Request-dependent roots
retain request evaluation and hydration. Vite and the server pair the HTML
template and root automatically; mismatched builds fail before delivery.
Development retains mounting and HMR.

A validated shell keeps the authored module script and its nonce/attributes
when interaction requires it, and removes that script when no browser work is
needed. Styles remain HTML build dependencies. No virtual duplicate graph,
alternate bootstrap or compatibility renderer is generated.

The compiler's initial-content plan and the next steps for interactive regions
are documented in `../../docs/browser-bundle-architecture.md`.

## Server definition contract

When present, `<server>/define.ts` exports the shared definition:

```ts
import { createDefine } from '@memoized-dom/server';

export const define = createDefine<RequestState, PlatformBindings>();
```

The plugin generates `.memoized/server-config.d.ts`, which registers the
definition's state and platform types plus every discovered exported service.
Normal server, middleware, route, and `$routed` imports then use that contract
without call-site generics.

```ts
export const session = define.middleware(async (context, next) => {
  context.state.user = await readSession(context.request);
  return next();
});

export const currentUser = define.function.get(
  async ({ state, services }) => services.users.find(state.user),
);
```

Declare services anywhere under the configured server root:

```ts
export const database = define.service('database', connectDatabase);

export const users = define.service('users', {
  dependencies: { database },
  create: ({ database }) => createUserRepository(database),
});
```

The generated registry exposes resolved service values as
`context.services.database` and `context.services.users`. Service modules
are imported into the server integration before requests are dispatched.

TypeScript projects must include `.memoized/**/*.d.ts`. Plain TypeScript
resolution also needs the aliases:

```json
{
  "compilerOptions": {
    "paths": {
      "#server/*": ["./src/server/*"],
      "#server-functions": ["./.memoized/server-functions.d.ts"]
    }
  },
  "include": ["src", ".memoized/**/*.d.ts"]
}
```

## Server boundaries

- `@memoized-dom/server` is the framework API carrying registered app types.
- `#server/*` resolves application-owned modules under the configured server
  root and is rejected from the client graph.
- `#server-functions` is the generated colorless facade. It preserves each
  function's parameters and resolved return type without exposing its server
  implementation to the browser.

Erased `import type` declarations may refer to server modules. Runtime value
imports from `#server/*` are intentionally rejected in the client graph.
Shared DTOs and schemas should live in a neutral application directory; a
browser-visible operation must be an explicit server function imported from
`#server-functions`.

## `$routed` compilation and transport

`$routed` is the router's authored route-preparation intrinsic. The same Vite
plugin produces its client and server forms; there is no route-loader plugin or
endpoint configuration to add.

```tsx
import { $routed, redirectRoute } from '@memoized-dom/router';
import { reports } from '#server/repositories/reports';

export function ReportPage() {
  const page = $routed(({ params, locals, signal }) => {
    if (!locals.user) return redirectRoute('/login');
    return reports.loadPage(params.reportId, locals.user.id, { signal });
  });

  return <h1>{page.report.title}</h1>;
}
```

For a server-backed preparation, the plugin:

1. keeps the callback and its `#server/*` dependencies in the server graph;
2. erases that callback body and those server imports from client output;
3. registers the extracted preparation with the generated server application;
4. installs the internal `/_memoized/routed` transport beside generated
   server-function routes; and
5. forwards only the preparation ID, destination URL/params, and JSON-safe
   application-owned `state` values from the browser.

The server attaches the real request, typed locals, platform, and services at
dispatch time. Those capabilities never enter the client bundle or transport
payload. Universal preparations that use only fields such as `params`,
`query`, `signal`, and `state` retain their callback in both environments and
do not generate a server round trip.

The callback must remain inline, synchronous, and assigned to a
component-local `const`. Return a service or server-function result directly;
the router settles it before navigation commits. See
`packages/router/README.md` for the complete authored and navigation contract.

## Development replacement

The adapter compiles connected module graphs and caches output per Vite
environment. During an edit it recompiles before notifying the browser,
invalidates every generated module whose output changed, and keeps generated
modules as self-accepting HMR boundaries. A failed transform leaves the last
successful graph active; the next successful edit sends a recovery update so
Vite can clear its overlay and replace the mounted definition.

Server requests load the current server entry through Vite's SSR environment
in the selected runtime. Backend edits replace the application while keeping
the native listener alive. SSR component edits and generated server functions
participate in the same replacement. Re-evaluation creates a fresh `serve()`
application, preventing routes and middleware from accumulating across edits.
Generated declarations and server-function manifests are replaced only after
successful generation. Browser component HMR retains the existing remount
behavior; component-local state can reset.

On Bun and Node, an optional named `dispose()` export in the server entry releases the previous
application's services after its outstanding response streams finish. Close
database pools and other application-owned resources there. Native listener
options and WebSocket callbacks are startup configuration; restart after
changing them. Long-lived upgraded sockets are managed by the native host.

Restart the Vite process after changing or rebuilding this plugin itself;
Vite does not hot-replace its own plugin hooks.

## Commands

```bash
bun run --cwd packages/vite test
bun run --cwd packages/vite bench
```
