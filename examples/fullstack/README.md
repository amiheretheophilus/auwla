# Fullstack demo

One server entry mounts the `serve()` application inside Hono on native Bun: middleware,
API routes with method dispatch and prefix-group protection, server functions
with their own middleware, and colorless SSR data through the in-memory
dispatch bridge.

## Run

```bash
bun run example:fullstack
```

Then open http://localhost:3000/. Hono owns `/api/backend`; the delegated
Memoized DOM application owns its API routes, generated functions, SSR, and
frontend assets. Vite supplies transforms and HMR through private tooling.

```bash
bun run example:fullstack:build
bun run example:fullstack:start
```

Production runs the same backend entry from `dist/server.js`. The build wires
the HTML template and client assets automatically; no static middleware is
added to the server entry.

The same `server.ts` can also run as a Cloudflare Worker:

```bash
bun run example:fullstack:cloudflare
bun run example:fullstack:cloudflare:build
bun run example:fullstack:cloudflare:preview
```

`vite.cloudflare.config.ts` selects the Worker host, and `wrangler.jsonc` holds
normal Cloudflare deployment settings. Hono keeps its normal default export.
The framework supplies the SSR document and asset binding automatically.
Development and preview execute backend code in `workerd`.

## What to look at

| Concern | Where |
| :--- | :--- |
| Application-wide locals contract | `server/config/index.ts` |
| Lazy app-scoped database/service setup | `server/config/services.ts` |
| Global + typed middleware, request locals | `server.ts` (`logger`, `session`, `createLocals`) |
| Typed GET route with JSON normalization | `server.ts` → `/api/health` |
| Typed POST route (405 for other methods) | `server.ts` → `/api/echo` |
| Prefix-group protection | `server.ts` → `/api/admin/*` |
| Server functions + module middleware + `getServerContext()` | `server/functions/stories.ts` |
| Colorless module source (SSR-settled, payload-hydrated) | `App.tsx` → `stories` |
| Reactive component-local source (request rebinding) | `App.tsx` → `StoryDetail` |
| Compiler-gated mutation + `$track` lifecycle | `App.tsx` → `postVote` |

## Walkthrough with curl

```bash
# Bare route
curl localhost:3000/api/health

# Method map: this 405s with an Allow header (only POST exists)
curl localhost:3000/api/echo
curl -X POST localhost:3000/api/echo

# Prefix-group protection: 403 without the header
curl localhost:3000/api/admin/stats
curl -H 'x-admin: yes' localhost:3000/api/admin/stats

# Generated server functions are ordinary HTTP endpoints
curl 'localhost:3000/_fn/stories/getStory?id=2'
curl -X POST localhost:3000/_fn/stories/postVote \
  -H 'content-type: application/json' -d '{"id":1}'
# Mutating server function guarded by its own context check
curl -X POST localhost:3000/_fn/stories/deleteStory \
  -H 'content-type: application/json' -d '{"id":3}'          # rejected
curl -X POST localhost:3000/_fn/stories/deleteStory \
  -H 'content-type: application/json' -H 'x-admin: yes' -d '{"id":3}'

# The page itself: resolved SSR + hydration payload
curl localhost:3000/ | grep -o 'mmd:r:App\|application/mmd+json'
```

Watch the server log: `[http]` lines come from the global middleware, `[fn]`
lines from the server-function module middleware — including when SSR
dispatches `/​_fn/stories/getStories` **in memory** while rendering `/`, with
no network loopback.
