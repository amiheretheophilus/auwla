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
- **Source languages** (`languages`, [core](core.md#source-languages)) apply to server code too: a
  language's module in the server folder is a server function module, a service module or a
  `#server/` target like a `.ts` one. It is analyzed as its TSX, with errors at the authored line.
  Its endpoint name and facade drop the language's extension (`functions/people.auwla` →
  `/_fn/people/...`, `.memoized/functions/people.ts`); `#server/people` probes its extensions as a
  relative import does. The declarations import the module by its own path (`people.auwla`).

Found while building it, and fixed: every module-level object got a reader and a version, even with
nothing reactive reading it; a server entry with `serve()` and `app.ssr(App)` emitted 2,757 bytes of
machinery, now 280 (`state-and-derived.md`, "Module state nothing reactive reads").

### Relative `$fetch` targets

A server render never resolves against a process-wide `location`: that belongs to no request (a
DOM shim registered on `globalThis`, Deno's `--location`). The render session creates its data
runtime with `baseURL: null` (`packages/server/src/session.ts`; the option in
`packages/data/src/types.ts`), so `$fetch('/api/user')` reaches the request's fetch as written.
serve() passes a fetch that resolves it against the request URL and dispatches same-origin routes in
memory; `render(App, { fetch })` hands the caller's fetch the relative target. Before 2026-11-14 an
omitted base fell back to `location.href`, and under a global `location` serve()'s routes went to
the network. Checked by `server/tests/initial-request.test.ts`, "server rendering ignores a
process-wide location".

### Request isolation

One server process renders every request with the same module instances. Module state that a
render writes (`export let visits = 0` raised by a helper the page calls, an object store pushed
to) would then be what the next request reads: with real users, one user's data on another
user's page. Seen on 2026-11-13: three requests to a compiler-next server build showed
`visits 1`, `visits 2`, `visits 3`, and a module-level derived value followed the leaked state.

Decided (2026-11-14, `decisions.md`): server rendering behaves like the browser, and the backend
stays traditional. Built the same day. In a server build (`routedEnvironment: 'server'`):

- **Which state.** `features/state/request-owned.ts` names the top-level bindings that a function
  outside server-only code writes: by assignment, update, member write or `delete`; by a listed
  edit method (`push`, `optimize/method-facts.ts`) or a `Map`/`Set` edit (`set`, `add`,
  `delete`, `clear`); or by passing it to a function declared in the program. Writes through an
  import, a namespace (`session.cart.push(x)`) or a local alias (`const list = cart.items;
  list.push(x)`) count. Not counted: a method that is not listed (`db.query(…)`), an argument to a
  global or a package's function, a write only at the module's top level (it runs once, at load,
  so every request starts from the same value), and writes from server-only code. So a client a
  page only calls stays one per process.
- **The record.** `features/state/request-dom.ts` runs after every pass that adds module code
  (`pipeline.ts`, after `link/captured-dom.ts`, whose captured default is state too). The module
  keeps its own top-level variables, which serve code outside any render: the module's top level,
  and a backend reading it. They are reached through an accessor object, the process record.
  `_initModuleState(record)` repeats the module's state setup against a fresh record. Each
  declaration of owned state (the authored bindings, the module's derived values, and every
  variable the generated machinery declares) becomes an assignment to the record. The generated
  statements of the setup, and authored ones that use the state or a module function that does,
  run again. Statements that use no state run once: imports, templates, component registration,
  a top-level `console.log`. `core/emit/dom.ts` marks what it hoists as process-wide (on its final
  tree, since `await.ts` clones the tree whole), and a later copy is recognised by its origin.
  Module source descriptions are among them: a source is described once per process
  (`describeSourceValue`) and each render follows it (`followModuleSource`) with its own
  record's inputs. Found by the delivered cases: describing it again for every render replaced
  the browser copy's description in the same process, as a hot update does, and the browser's
  source stopped requesting again when its input changed.
- **Finding it.** Functions keep one identity per process. One that uses the state starts with
  `const _state = _moduleState()` and reads `_state.visits`; closures it creates keep that record,
  since they belong to the render that created them. A use outside any function that runs later
  (a class field initializer, a default parameter) asks `_moduleState()` right there. Which uses
  mean the module's variable, past a parameter or local of the same name, is decided by
  `request-scope.ts`, since the analyzer never saw the generated code.
- **Namespaces.** A namespace object holds the module's native exports, the process copy. In a
  server build a member that names owned state (`store.cart`) reads through that binding's
  reader instead (`requestOwnedMember`, `shared-dom.ts`).
- **The runtime.** `requestModuleState(process, initialize)` (`runtime/src/module-state.ts`)
  answers with the process record outside a server render (the environment mode is not
  `server-*`). Inside one, it returns that render's record, building it the first time with no
  build frame and no running computation, as a module's top level runs (`outsideBuild`,
  `build-scope.ts`). The record lives on the render's application runtime, which follows `await`
  on a server, and goes with it. A setup that throws leaves no record, so the next use tries again.
  Until the module's top level finishes, `_moduleState()` answers with the process record: the
  module is still evaluating.

The old compiler did this with per-request cells for literal initializers only (`docs/09-ssr.md`,
`moduleStateCells`); here any initializer re-runs per render.

Remaining limits:
- A module whose state setup itself waits (`let n = await load()`) keeps shared state: a record
  is built synchronously.
- State inside a third-party library stays process-wide; the decision says the docs must say so.
- A record belongs to one render's application runtime. A request that renders more than once
  (a page and then a server-backed `$routed` preparation) gives each render its own record.

Checked by `server/request-state.test.ts` (three requests to a built server each show exactly
their own visit; it was an expected failure until this change) and
`features/state/request-dom.test.ts`, which runs compiled modules in two server renders and outside
any render. It covers imports, namespaces, aliases, a captured default, derived values,
shadowing, arrows, methods, class fields, default parameters and destructuring, plus what stays
shared: unwritten bindings, top-level-only writes, server-only modules, the browser's build, and
a setup that waits.

### Backend code

Server-only code is compiled as plain code (DX-30, `wiki2/decisions.md`: backend code is not
reactive). The application declares it to the server project through the `serverOnly` option
(`options.ts`): the server folder, the server entry, and the generated routes registry and
`serve()` wrapper. Not the facades: components call them, in both builds. That code runs once per
request or once at start, never inside a render; the browser reaches it only over HTTP or through
a server-backed `$routed`. So, in `graph.resolved.serverOnly(module)`'s modules:

- module bindings get no reader or version (`features/state/reactive-reads.ts`), so a store an
  endpoint edits stays a plain array;
- edits are not observed (`planImportedMutations` is skipped in `core/plan/index.ts`), and with
  no planned edit its functions get no callback boundary (`features/handlers/callbacks.ts`);
- no source readiness is planned (`features/sources/flow-plan.ts`) unless the module calls
  `$fetch`/`$read`/`$track` or holds markup (a page function, a component declared there);
- a `try` or `await` adds no build recovery or write flush when the module renders nothing
  (`core/emit/dom.ts`).

Pages the server renders keep everything: they are not server-only code. Before (the `.auwla`
directory example): `server/people.auwla`, a 20-line in-memory store, compiled to 3,338
characters; its server function module to 4,129; the entry to 1,089; the registry to 9,377. After:
486, 296, 273 and 2,073, the store and functions exactly their authored JavaScript.
`server/application.test.ts` checks the output has no runtime machinery and fails when nothing is
declared server-only; the JSX+ server and Vite tests run the result.

Found by the `.auwla` directory example (`packages/jsx-plus/examples/directory`), and fixed: once a
page reads a server function, the server graph has sources and imports a package, so `serve(...)`
may return one (`features/sources/reach.ts`) and the entry's top-level `app.ssr(App)` becomes a
builder step. With no module state, nothing declared that step's readiness storage, and the built
server threw `_sourceStep is not defined` on start. `core/emit/shared.ts` now declares it at the
top of such a module (`sourceReadinessStorage(plan, null, …)`). The Bun plugin's server test passed
only because its page read no server function. The entry is now plain backend code (above), but
any module whose top level waits with no module state still needs it (`shared-dom.test.ts`).

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
