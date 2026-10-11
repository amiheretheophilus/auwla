# Adapters

This project does not support legacy APIs. All packages and consumers must use the current APIs. Do not add compatibility shims, deprecated aliases, or fallback paths for superseded APIs.

Native host boundaries and production asset readers for Memoized DOM.

| Import | Purpose |
|---|---|
| `@memoized-dom/adapters/bun` | Bun application handler and filesystem asset delivery |
| `@memoized-dom/adapters/node` | Node HTTP conversion and filesystem asset delivery |
| `@memoized-dom/adapters/cloudflare` | Worker asset binding delivery |

Applications normally default-export `serve()` or another backend's `fetch`
handler and use the fullstack launcher/build. The generated integration selects
these host helpers and installs frontend delivery automatically; applications
do not need to wire an asset reader or static middleware themselves.

See the [SSR setup guide](../../docs/09-ssr.md) and
[Vite integration](../vite/README.md) for Bun, Node, and Cloudflare setup.
