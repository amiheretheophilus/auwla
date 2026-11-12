# Server

**Folders:** `server/`

Status (2026-11-12): server function analysis, client facades and declarations are built, and match
the old compiler's exactly. The application (a client and a server build of one project), the server
function registry and the server entry's integration are next. The user asked (2026-11-12) that the
project compile SSR without Vite, so that Vite and the Bun plugin are thin adapters with the same
features.

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

## Design: the application

Planned, so that any tool gets SSR from the project:

- `createApplication({ client, server?, serverRoot = 'server', host })` makes two projects over one
  host. The client build compiles with `routedEnvironment: 'client'` (server-backed `$routed`
  bodies dropped), `#server-functions` resolving to the generated barrel of facades, and `#server/*`
  never followed: a `#server/` import left in client output is an error. The server build compiles
  with `routedEnvironment: 'server'` and `dataDelivery: 'universal'`, `#server/*` resolving into the
  server root.
- Generated modules (the facades, the barrel, the registry) are virtual files in the host under
  `./.memoized/`, so they are compiled, mapped and updated like any module.
- The registry (`serverFunctionRoutes`) is generated from every module in `server/functions/`,
  with folder `_middleware.ts` files and service registrations, as the old Vite plugin did
  (`packages/vite/src/server-functions.ts`).
- The server entry's `serve` import is bound to a generated module that integrates those routes
  with a delivery module the tool supplies (`document(request)` and `assets(request)`), as
  `packages/vite/src/fullstack.ts` did: the document and the assets depend on where the app runs
  (a dev server, built files, Workers), the routes do not.
- A client build with a server installs the hydration runtime in its entry.
- `update(paths)` rebuilds both programs and names what changed in each.

## Files

| File | What it owns |
| --- | --- |
| `server/functions.ts` | Analysis of a server function module: endpoints, methods, parameters, errors |
| `server/generate.ts` | The client facade of a module, and the barrel's declarations |
| `server/functions.test.ts` | Analysis, facades, declarations and errors, compared with the old compiler |
