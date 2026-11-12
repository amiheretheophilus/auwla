# Server

**Folders:** `server/`

Status (2026-11-12): server function analysis, client facades and declarations (matching the old
compiler's exactly), the application (a client and a server build of one project), the registry and
the server entry's integration are built. The Bun plugin and the command line building both, and a
server actually answering a request in a test, are next. The user asked (2026-11-12) that the project
compile SSR without Vite, so that Vite and the Bun plugin are thin adapters with the same features.

## What it does

An application with a server has two programs: the client entry's and the server entry's
(`docs/09-ssr.md`). Server functions live in `server/functions/` (`docs/12-server-functions.md`);
client code calls them through `#server-functions`, which a client build turns into facades that
call each endpoint over HTTP, while the server build routes each endpoint to its handler.

- `analyzeServerFunctions(moduleId, source, functionsRoot)` (`server/functions.ts`) reads what a
  module exports from its syntax alone: each `define.function({ get|post|put|patch|delete })`,
  its endpoint (`/_fn/<module>/<name>`), its method, and its transported parameters. A GET's go
  in the query, so each needs one scalar type. Any other export is an error, since it would cross
  the client boundary.
- `serverFunctionClient(module)` (`server/generate.ts`) is the facade: the same names, calling
  `$fetch` (or a streaming or page source) with the parameters in the query or a JSON body.
- `serverFunctionDeclarations(modules, resolve)` types the flat `#server-functions` barrel through
  type-only imports of the real handlers. Names must be unique across modules.

The old compiler (`packages/compiler/src/server-functions.ts`) is the oracle: the server package
routes by the same metadata, so `server/functions.test.ts` compares the analysis, the facades and
the declarations with its output, and every error with its error.

## Application

`createApplication({ client, server?, serverRoot = 'server', delivery?, host, ...options })`
(`server/application.ts`) makes two projects over one host, each seeing it through its own view:

```ts
const application = createApplication({ client: './src/main.ts', server: './server.ts', host: fileSystemHost(root) });
const { client, server, functions, declarations } = await application.build();
```

- **Client build:** `routedEnvironment: 'client'` (server-backed `$routed` bodies dropped),
  `dataDelivery` `universal` with a server and `client` without. `#server/*` is never followed; a
  `#server/` import left in client output is an error, so server-only code cannot ship. With a
  server, the entry gets `import '@memoized-dom/runtime/hydrate'` appended, so it adopts the
  server's markup (appended, so the entry's offsets and map stay in place).
- **Server build:** `routedEnvironment: 'server'`, `dataDelivery: 'universal'`. `#server/*`
  resolves into the server folder. The entry's `@memoized-dom/server` import resolves to a
  generated module (`./.memoized/server-application.ts`) that re-exports the package, with
  `serve()` installing the routes and the delivery module through `integrateApplication`.
- **Both:** `#server-functions` is the generated barrel (`./.memoized/server-functions.ts`) of
  facades (`./.memoized/functions/<module>.ts`). A component rendered on the server calls them as
  the browser does.
- **Generated modules** are virtual files of the host's views, so they are compiled, mapped and
  updated like any module. Resolved imports are printed as relative paths
  (`link/specifiers.ts`), so a tool loads the output without knowing these rules.
- **The registry** (`./.memoized/server-functions.server.ts`, `server/registry.ts`) imports each
  handler by name (not as a namespace, which the compiler would follow as a live input), and
  gives each route its folders' `_middleware.ts`, its module's and its own middleware, plus the
  endpoint that runs a server-backed `$routed` preparation. Services (`define.service('name')`
  anywhere in the server folder) are imported for their registration.
- **Delivery** (`delivery`, default `virtual:memoized-dom/delivery`) is the tool's module with
  `document(request)` and `assets(request)`: the page's HTML shell and its files depend on where
  the app runs (a dev server, built files, Workers); the routes do not. A relative one is relative
  to the project.
- `declarations` is the text of `.memoized/server-functions.d.ts`, which a tool writes for
  TypeScript; null without functions.
- `update(paths)` rebuilds both programs and names what changed in each. An edit in the server
  folder regenerates the barrel, the facades and the registry.

Found while building it: every module-level object got a reader and a version, even with nothing
reactive reading it (`export const database = { users: new Map() }` emitted 1.6 KB, and a server
entry with `serve()` and `app.ssr(App)` 2.7 KB of shared-state and source machinery). That is the
next fix, for client builds too (`state-and-derived.md`).

## Files

| File | What it owns |
| --- | --- |
| `server/functions.ts` | Analysis of a server function module: endpoints, methods, parameters, errors |
| `server/generate.ts` | The client facade of a module, and the barrel's declarations |
| `server/functions.test.ts` | Analysis, facades, declarations and errors, compared with the old compiler |
| `server/registry.ts` | The server function routes module, the `#server-functions` barrel, and services |
| `server/application.ts` | `createApplication`: the client and server builds, their views of the host, the server entry's integration |
| `server/index.ts` | The public API, re-exported from the package root |
| `server/application.test.ts` | Facades and no server code in the client, routes and handlers on the server, client-only apps, server-only imports, `$routed`, errors, updates |
