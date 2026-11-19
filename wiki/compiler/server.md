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
- `app.ssr(Page)` passes the compiler's component adapter (a component used as a value,
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

The old compiler (`packages/compiler/src/server-functions.ts`) was the oracle while it existed: the
server package routes by the same metadata, so `server/functions.test.ts` compared the analysis,
the facades and the declarations with its output. Since its deletion (2026-11-17) the test states
what both agreed on: each function's method, endpoint and parameters, the facade's calls and the
barrel's types, and every error.

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
  `#server/` import left in client output is an error, so server-only code cannot ship. Neither can
  the server folder (or a functions folder outside it) reached by a relative path
  (`../server/functions/users`): it is reported at the importing module, naming the import, and
  pointing to `#server-functions` (`serverFolderImport`; found by the Vite tests, 2026-11-17). With a
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
- **Server types:** `serverConfigDeclarations` is the text of `.memoized/server-config.d.ts`
  (`server/config-declarations.ts`): the folder's `define` module (`createDefine<State,
  Platform>()`) gives each request's `state` and `platform`, and each `define.service('name')` a
  field of `services`, registered in `@memoized-dom/server/router`'s `ServerTypeRegistry` and
  `@memoized-dom/router`'s `RoutedTypeRegistry`. Null without a `define` module. Ported from the old
  Vite plugin's `server-config.ts`.
- `declarationFiles(build)` lists the declaration files by project path (null removes one; route
  types are left out while the client fails), so every tool writes the same set. A failed discovery
  keeps the last good one's declarations, so the editor's types stay while the folder is fixed.
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
user's page. Seen on 2026-11-13: three requests to a server build showed
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

- **A setup that waits** (`let n = await load()`). A component cannot stop to wait, so such a
  module's setup is emitted `async` and registered when the module loads
  (`registerWaitingModuleState`, by module path, so a dev server's re-evaluation replaces it). A
  server render builds those records before it mounts: `RenderSession.prepare()` awaits
  `prepareRequestModuleStates()` with the render's runtimes active, in evaluation order. Each
  render therefore runs the module's top-level `await` again, as a browser loading the page
  would. A render that did not prepare (`renderToString`, which cannot wait) and touches such a
  module gets an error, never the process's copy. Built 2026-11-14, at the user's request.

Remaining limits:
- State inside a third-party library stays process-wide; the decision says the docs must say so.
- A record belongs to one render's application runtime. A request that renders more than once
  (a page and then a server-backed `$routed` preparation) gives each render its own record.

Checked by `server/request-state.test.ts` (three requests to a built server each show exactly
their own visit, and their own copy of state whose setup waits; it was an expected failure until
this change) and `features/state/request-dom.test.ts`, which runs compiled modules in two server
renders and outside any render. It covers imports, namespaces, aliases, a captured default,
derived values, shadowing, arrows, methods, class fields, default parameters, destructuring and
a setup that waits (built per render, an error when not prepared), plus what stays shared:
unwritten bindings, top-level-only writes, server-only modules and the browser's build.

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
  (`core/emit/dom.ts`). Both passes follow `guardsWrites`, as the runtime import does. Before
  2026-11-19 they ran regardless, so a server-only module that awaited and also read state another
  module exports (which keeps it on the full emit path, for its readers, with no runtime import)
  got `_MD.flushWritesBeforeAwait(...)` and no `_MD`: the Triaxis server threw "_MD is not
  defined" on its first member page. `server/application.test.ts` ("keep server-only code that
  reads shared state plain") covers it.

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

## Delivery and runtimes

A built server gets its page and the built client's files from a delivery module (`server.delivery`,
read by the integration). `server/delivery.ts` generates it for the runtime the server runs on, so a
deployment target is the compiler's, not a bundler plugin's (`../decisions.md`, 2026-11-14):

- `bun`: the client sits beside the server in `./client/`, read from disk
  (`@memoized-dom/adapters/bun`).
- `cloudflare`: a Worker has no disk. The client is uploaded as the Worker's static assets and read
  through its assets binding, `env.ASSETS` from `cloudflare:workers`
  (`@memoized-dom/adapters/cloudflare`). `workerConfig` writes the `wrangler.json` that says so: the
  Worker runs first for every request, `nodejs_compat` for request context (`AsyncLocalStorage`),
  and `COMPATIBILITY_DATE`, a date the framework is tested with rather than the day of the build,
  which a local workerd may not support yet (found by the test: workerd refused to start).

- **A Worker's bindings** (2026-11-16, found by the Vite acceptance run): workerd calls the exported
  application as `fetch(request, env, ctx)`, while the application reads bindings as
  `platform.env` and `platform.executionCtx` on every runtime. With `server.runtime: 'cloudflare'`
  the generated server wrapper (`serverApplication`, `server/application.ts`) turns that call into
  `{ platform: { env, executionCtx } }`; a two-argument call from a Hono backend passes through. The
  CLI and the Vite plugin pass the runtime.
- **A server built on its own** (`vite build --ssr server.ts`, no client build beside it):
  `standaloneDeliveryModule()` gives no page and no files, so the application renders into the
  template it is given (`installDocumentTemplate`).

`cli.ts build … --server server.ts --runtime cloudflare` bundles the server for workerd as
`worker.js` (`conditions: workerd`, `cloudflare:*` and `node:*` left as imports) beside `client/`
and `wrangler.json`; `wrangler deploy --config dist/wrangler.json` deploys it. `project/cli.test.ts`
runs the built Worker in workerd through Miniflare: a page render, per-render module state, a client
file through the assets binding, a server function, and one reading a binding through `platform.env`. The Vite plugin's `cloudflare()` wraps
`@cloudflare/vite-plugin` for Vite's dev server; the Vite path is one way, not the only one.

The Vite plugin writes its production delivery with the same `deliveryModule` (2026-11-17), which
also takes `node`, the client's `base`, its assets folder, route styles (`routes.md`, "A lazy
route's styles") and a client folder the bundler places (`clientRoot`). `hostEntryModule('bun' |
'node', entry)` is the module a built server starts from: on Bun the entry's own host options and
`fetch`, on Node a listener when run directly, whose failed request answers 500 through the
promise's rejection handler (no `try`, `../rules.md`, rule 5).

## WebSocket server functions

`define.function({ live, websocket })` uses the server-function registry and
request pipeline. `server/functions.ts` recognizes a WebSocket handler and
rejects HTTP verbs, `updates`, generators, and JSX in the same definition.
`server/generate.ts` builds a typed `#server-functions` facade backed by
`packages/data/src/socket.ts`. The browser sends named JSON arguments or the
existing schema `input` once during the upgrade.

The adapters in `packages/server/src/websocket/` dispatch the handshake through
the normal `fetch` and middleware chain. A capability on the request associates
the validated session with the native connection. `room.ts` scopes membership
to the endpoint and its `live` key. Each room orders lazy initial reads and
message handlers. Ordinary returns are sent to the room and `replyToSocket`
correlates a private return to the sender. The room event and its acknowledgement
reuse the same serialized result. A connection leaves the room when its native
socket closes. A result from its optional `close` hook reaches the remaining peers.

Bun keeps one set of live sockets for application shutdown. Room membership
lives in Bun's native topics. A room publishes its encoded frame once per
listener, so a process can serve the same room through multiple listeners.
The native socket keeps the session after opening and releases the upgrade
record. Node uses Crossws and the shared runtime's peer delivery. It releases
the temporary upgrade options when dispatch begins.

Bun bounds each socket's write buffer. If a native publish reports a dropped
frame, the adapter checks that topic's peers on the affected listener and
disconnects those over the limit. This gives the client a reconnect and fresh
initial snapshot. The successful publish path walks only the room's listeners.

Cloudflare generates a Durable Object class and forwards upgrades to one object
per application. That object shares the room runtime across Worker isolates and
uses awake sockets to preserve the handler's closures. The CLI emits its binding
and migration when the application declares a WebSocket server function.

`server/websocket.app.test.ts` exercises built Bun, Node and workerd servers,
including middleware, argument transport, room isolation, private results, and
late joins. Bun coverage includes multi-listener delivery and a stopped reader.
A browser uses the generated facade and verifies reconnection.
The [authoring guide](../../docs/12-server-functions.md#websocket-rooms) shows the API.

## Server pages

Status (2026-11-15): built, on (a) below (`../decisions.md`, 2026-11-15). `server/pages.app.test.ts`
builds an application with the command line and checks the built server and, where a Chromium is
installed (`MMD_CHROME_PATH`; this machine has Edge, not Chrome), the browser: the page in the
document, an endpoint's versioned HTML carrying only the fields the browser reads, a passive page
with no binding and no code in the client, the interactive page bound, a later page of the same call
site updating it in place with its local state and nodes, and another page replacing it.

A server function can return markup: `return page(<ExpeditionBoard notes={notes} />)`
(`docs/server-components-design.md`). The server renders it; the browser gets HTML, plus a program
only if the markup can change by itself (a click handler, a ref, an effect). Authoring is the old
compiler's. The runtime pieces it uses were already there (`createPageSource` in `packages/data`, the
page transports, `registerPageBinder`), and the facade already called `createPageSource`
(`server/generate.ts`). The compiler's side, which the old compiler split between
`packages/compiler/src/server-pages.ts`, `page-compiler.ts`, `page-projection.ts` and
`packages/vite/src/server-pages.ts` (the browser's table, in the plugin), belongs to the application
here (`../decisions.md`, 2026-11-14), so Vite, the Bun plugin and the command line all get it:

1. **Extract** (`server/pages.ts`). In a server function module, each `page(<JSX/>)` call becomes
   `createComponentPage(id, Page<n>, [captures], contract)` in the server build's copy of the
   handler (appended imports, so the authored offsets stay). `page` is recognized by where it comes
   from, never its name: `@memoized-dom/server`, or a project module re-exporting it, which
   `page-build.ts` follows through the host (`export { page } from …`, or import then export). Its
   JSX moves into `./.memoized/pages/<module>.tsx` as `Page<n>(inputs)`, whose inputs are the values
   the JSX captures (`identifierUses`, `core/resolve`); component tags must be imports, which the
   page module imports from its own folder. The handler stays plain backend code; the page module
   is UI, compiled like any component in both builds. The old compiler's errors stay: one JSX
   argument, no nested `page()`, no escaping `page`, no local component tag. A handler holding JSX
   without `page()` is an error.
   - **In a source language's module** (`.auwla`, the user's direction 2026-11-15: server pages
     work there as in `.tsx`), extraction reads the language's TSX, and the page module is built
     from it. The server's copy of the handler is the authored module with each call replaced, at
     the place the language's origin gives for the call's first and last characters, which are
     copied verbatim; the replacement and the appended imports are plain TypeScript, so the
     language reads the module as usual and the rest keeps its authored positions. Checked by
     `packages/jsx-plus/tests/server-pages.test.ts` (`fixtures/apps/server-pages`, all `.auwla`):
     the server's answers, the client's file, and binding in happy-dom.
2. **Decide what the browser gets**, per page (`page-build.ts`), from what that page alone reaches
   (the page module with only its component, then every project module through imports, native
   packages included): a page with no `on*` handler, `ref`, spread attribute, `$effect` or
   `$cleanup` among them, and no package outside the project, is `browser: 'none'`. It ships no
   code and no inputs; the browser's copy of the page module leaves it out. This is a scan of the
   syntax, as the old compiler's was, not the plan's facts, which the application does not have
   before it builds.
3. **Choose the inputs** (`page-inputs.ts`): every path the page's components read from each
   capture, followed through bindings, destructuring, props, defaults, member reads, array
   callbacks (rows as `*`), `Array.from(rows, mapper)` (what an `.auwla` loop in markup becomes),
   what `filter` and `find` return (still the input's rows), local helpers and imported
   components. The old projection lost rows read after a `filter` (`visible = tasks.filter(…)`,
   then a loop over `visible`), so their fields were not sent; found by the example
   (`packages/jsx-plus/examples/server-pages`). Reading `user.name` and
   `user.hint` sends those, not `user.password`. A value reaching code it cannot follow (an unknown
   call, a spread into an unknown component, a recursive component, `a ? user : other`) is sent
   whole, and the server's `projectPageInputs` refuses what cannot be sent, such as a function. This
   is the old `page-projection.ts` ported to the compiler's parser, a second walk of the syntax
   rather than the graph's read paths the design first named: the graph knows reads per module, not
   values followed into another component's props.
4. **Styles travel with the page** (`page-build.ts`). The contract's `styles` hold the CSS of the
   `<style>` blocks of every language module the page reaches, `@use` across files resolved as the
   project resolves it (`project/style-sources.ts`), and of the handler module itself, whose JSX
   moved into the page. The server sends them with the page's HTML (`<style data-mmd-page-style>`,
   in the document too), so a page that ships no code still arrives styled: its component's
   stylesheet never reaches the client build. A plain `.css` file a page imports is not carried yet.
5. **The browser's table** (`./.memoized/page-bindings.ts`): `virtual:memoized-dom/page-bindings`,
   which the facades import, resolves to it in both builds. It holds each page's id and contract
   key, and for a page with bindings a lazy import of `./.memoized/pages/<module>.bindings.ts`,
   which calls `registerPageComponent(key, Page<n>)`. The server's copy loads nothing. With a page
   that has bindings, the browser's entry also imports `page-hydration.ts`, whose top-level
   `await preparePageHydration()` loads the bindings of the pages in the document's source
   snapshots before the entry mounts.
6. **The runtime.** `createComponentPage` (`packages/server/src/page-definition.ts`) calls the page
   component with a props cell (the compiler's components take one, not the old props array), and
   a page with bindings is rendered inside one `display: contents` element. The compiler's value
   slot shows page content through `mountPage` (`runtime/src/content-region.ts`, shared with the old
   compiler's `createContentRegion`). In the browser, `registerPageComponent`
   (`runtime/src/page-bindings.ts`) renders the component again into that element, in its own
   runtime on the real document, and gives later inputs to its props cell. It does not adopt the
   server's nodes: numbers of the page's own would collide with the containing app's, which
   `collectCreations` gathers from everywhere inside its root. The browser gets the same code either
   way; only the region's nodes are made again, once, when it is bound.

The Vite suite's `packages/vite/tests/server-pages.test.ts` authored its board in `.tsrx`; since
2026-11-17 it is `.tsx` and runs on the compiler (open items: `testing.md`). Not yet: progressive
delivery of an interactive page (its server renders it in one go, as the old one does for a page
with bindings).

**A passive page's progress.** A page with no bindings streams as its sources settle
(`serverPageUpdates`, `packages/server/src/page.ts`): each frame carries the regions that changed.
It tracked only the old compiler's marker ranges, so a page from this compiler sent no regions and the
browser never filled in what settled. It now chooses as the document stream does (`stream.ts`):
numbered elements for the compiler output (2026-11-17). Checked by `packages/server/tests/pages.test.ts`,
which compiles its pages with the compiler's `extractPages` since the old compiler's deletion.

**What an interactive page ships** (decided: (a)). The compiler's adoption is a client render that reuses
the server's nodes (`delivery.md`, "Adopting existing nodes"), so a page's browser program is its
whole compiled component, and its inputs are every path that component reads, text included:

- **(a) Adopt now.** Build server pages on adoption as it is. Passive pages ship nothing; an
  interactive page ships its component and the data it renders. When delivery's step 3 (update code
  with no creation code, for content the server already sent) is built, pages get it with every
  other page, since they share the path.
- **(b) Bindings first.** Build delivery's step 3 first, then server pages on it, so an interactive
  page ships only the code and inputs of its live parts. This is the old compiler's answer
  (`browser: 'bindings'` refused anything it would have to create), and it is a general delivery
  change, more work before the merge.

## Files

| File | What it owns |
| --- | --- |
| `server/functions.ts` | Analysis of a server function module: endpoints, methods, parameters, errors |
| `server/generate.ts` | The client facade of a module, and the barrel's declarations |
| `server/functions.test.ts` | Analysis, facades, declarations and errors, compared with the old compiler |
| `server/registry.ts` | The server function routes module, the `#server-functions` barrel, and services |
| `server/config-declarations.ts` | `.memoized/server-config.d.ts`: request state, platform and service types from `define.ts` and the services |
| `server/application.ts` | `createApplication`: the client and server builds, their views of the host, the server entry's integration |
| `server/delivery.ts` | A built server's delivery module for Bun or a Cloudflare Worker, or for a server built on its own, and the Worker's `wrangler.json` |
| `server/pages.ts` | Server pages: `page(<JSX/>)` extracted into a page module, the handler's replacement, its errors |
| `server/page-inputs.ts` | Which paths of a page's inputs its components read, so only those cross to the browser |
| `server/page-build.ts` | A module's pages in the application: what `page` names, what each page reaches, its contract, the browser's table |
| `server/pages.test.ts` | Extraction (the old compiler's cases) and input projection |
| `server/pages.app.test.ts` | A built application with pages: the server's answers, the client's files, and the browser |
| `server/index.ts` | The public API, re-exported from the package root |
| `server/application.test.ts` | Facades and no server code in the client, routes and handlers on the server, client-only apps, server-only imports (by `#server/` and by path), server types, `$routed`, errors, updates |
