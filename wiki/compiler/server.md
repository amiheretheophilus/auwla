# Server

**Folders:** `server/`

Status (2026-11-12): server function analysis, client facades and declarations (matching the old
compiler's exactly), the application (a client and a server build of one project), the registry and
the server entry's integration are built, and the Bun plugin and command line build both programs: a
server built that way renders its page, serves the client's files and answers its server functions
(`project/bun.test.ts`, `project/cli.test.ts`). The user asked (2026-11-12) that the project compile
SSR without Vite, so that Vite and the Bun plugin are thin adapters with the same features.

Running it found two things, both fixed:

- `serve()` was redirected for every `@memoized-dom/server` import, including the app's
  `define.ts` (`createDefine`). The generated module imports every server function and server
  functions import `define`, so that made a cycle, and a function read `define` before it was set.
  Only a module that takes `serve` (by name, as a namespace, or re-exported) gets it now, as the old
  Vite plugin decided.
- `app.ssr(Page)` passes compiler-next's component adapter (a component used as a value,
  `componentValue`), and the server's render session called it, getting a render value and
  printing `[object Object]`. The session now renders the component behind it
  (`valueComponent`, `packages/runtime/src/components.ts`; `packages/server/src/session.ts`); for
  an old compiled root it is the root itself.

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

`createApplication({ client, server?: { entry, folder?, functions?, delivery? }, host, ...options })`
(`server/application.ts`) makes two projects over one host, each seeing it through its own view:

```ts
const application = createApplication({
  client: './src/main.ts',
  server: { entry: './server.ts', folder: './server' },
  host: fileSystemHost(root),          // root: the app's folder, which project paths are relative to
});
const { client, server, functions, declarations } = await application.build();
```

**No folder is server-only by its name** (the user's direction, 2026-11-12): the application is told
which one is (`server.folder`). Without one, nothing is server-only, no server functions are looked
for, and a `#server/` import is an error asking for the folder. Server functions are read from
`functions` in that folder, or from `server.functions` when given (`'./api'`).

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

Found while building it, and fixed: every module-level object got a reader and a version, even with
nothing reactive reading it; a server entry with `serve()` and `app.ssr(App)` emitted 2,757 bytes of
machinery, now 280 (`state-and-derived.md`, "Module state nothing reactive reads").

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
