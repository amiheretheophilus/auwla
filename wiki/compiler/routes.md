# Routes

**Folders:** `features/routes/`; the router side is `packages/router/src/route-reads.ts`.

Status (2026-11-12): `route="…"` regions, `route-to` links, the route table, reads of `route` and
`$routed` preparations are built, and a `suspend` route page whose param changes waits behind its
pending policy (the router scrolls once it commits). A client build loads a component imported only
for its routes with its route ("Lazy route chunks"). Server-backed preparations work end to end,
and a page the server renders links its lazy routes' styles (both 2026-11-14, below).

## What it does

Lowers the two routing attributes (`docs/07-routing.md`) to ordinary JSX before analysis, so a
route region gets the same tracking, adoption and delivery as any conditional:

```tsx
<main>                                  <main>
  <Home route="/" />                       {$routeRegion("…/Home:%2F") && <Home key={$routeRegion("…/Home:%2F")} />}
  <a route-to="/about">About</a>           <a href="/about">About</a>
</main>                                 </main>
```

- `routeRegion(id)` is the region's identity while its route matches (the path its match
  consumed), and null otherwise. The compiler runs a call it cannot see into inside a tracked
  computation, and the router reports the read there (`route-reads.ts`), so the region follows
  navigation with no special case in the compiler.
- Keying the content by that identity remounts it on a new path: `/story/1` → `/story/2` starts
  `Story` afresh, while a layout above it stays mounted. A query or hash change keeps it.
- `route-to` becomes `href`; with params, a query or a hash it is built by the router's
  `buildRoutePath`. The router's click handler makes a click on it navigate in place.
- It also gets `aria-current={currentPage(href)}` (`router/src/internal.ts`), `'page'` while the
  link's path is the page shown. A call the compiler cannot see into, so it follows `route.href`
  as any route read does. A link that sets `aria-current` itself keeps it. The reference
  (`tests/reference/routes.ts`) adds the same, with its own `$routeCurrent`. Routed pages were
  never static (their regions read the route), so a link costs no delivery. The `aria-busy` the
  router puts on links while it waits (`router/src/waiting.ts`) is the router's, not compiled
  output, so the case harness leaves it out (`tests/harness/serialize.ts`).
- Native POST forms stay browser-owned in the Navigation API path. A navigation with
  `NavigateEvent.formData` bypasses route interception, so the server receives
  the submitted body and can return cookies or redirects.
- The module of each root component (one no other component calls) installs the route table at
  its top with one call, `installRouteTable([...])`. A table held in a module binding would be
  state the compiler follows, and cost far more code.

## Files

| File | What it owns |
| --- | --- |
| `features/routes/index.ts` | `lowerRoutes`: runs on a first analysis, since joining routes needs the whole program; the lowered text is analyzed again (`analysis/frontend.ts`). A program without routes is analyzed once |
| `features/routes/collect.ts` | Per module: route elements (templates), calls of components, `route-to` links |
| `features/routes/graph.ts` | Route contexts, instances, full patterns and the checks across modules |
| `features/routes/lower.ts` | The text edits, the table and the `route:context` prop |
| `features/routes/base.ts` | The `base` option: checked, `/app/` read as `/app`, and written in front of a link (below, "Base path") |
| `features/routes/patterns.ts` | Pattern rules: leading `/`, no query/hash/empty segment, terminal `*`, unique params |
| `features/routes/declarations.ts` | `.memoized/routes.d.ts` from the full patterns (below, "Route types"); tested in `declarations.test.ts` |
| `features/routes/routed.ts` | `$routed` calls: their checks, server classification and the sources they make |
| `features/routes/routes.test.ts` | Output shape and every compile error, routes and `$routed` |
| `features/routes/routed.dom.test.ts` | Sources made inside a preparation are settled before it caches or returns them |
| `features/routes/split.ts` | Lazy route chunks: which imports load with their routes (`planRouteSplits`), and the printed importer's swap (`splitRouteImports`) |
| `features/routes/split.test.ts` | Which imports split and which stay, and the loader each table entry gets |
| `optimize/route-regions.ts`, `route-regions.test.ts` | A component's region, `{$routeRegion(id) && <X key=…/>}`, shown as one value slot instead of a conditional: `routeRegion` gives an id or null, so the falsy branch writes nothing and the selector never waits. About 65 lines per route became about 15 (2026-11-20). An element's region keeps its conditional, whose branch clones a template. Per navigation it does no more work: one computation instead of two, no region anchors. A region reads `routeRegion(id)` twice (to choose, and as the key); `router/src/region-identity.ts` works each identity out once per matches array, so the second read is a map lookup. The component's props are the site's `whileShown` inputs: an unmatched region skips their changes, as the conditional's selector did (before that, a prop change in an app with 11 routes re-ran all 11, 1.26x slower in `bench/navigation`). Timed against the same build without the pass (`optimize: { skip: ['route-regions'] }`) by `bench/navigation`: faster to mount and navigate, equal elsewhere |
| `tests/cases/routes.test.ts` | Behaviour compared with the reference's own lowering (`tests/reference/routes.ts`) |
| `tests/cases/routes.lazy.test.ts` | Lazy pages loaded on navigation and before mount: props, children, params, module state, nested lazy pages, preparations |
| `packages/router/src/route-reads.ts` | Reads of `route` fields and regions, published per key on navigation |
| `packages/router/tests/route-reads.test.ts` | Which reads a navigation wakes |

## Route contexts

A route element inside another joins its pattern to the outer one. So does every route a
component renders when the component is called inside a route: the route around a call is its
**route context**, found lexically in the caller (children and render props belong to the
component that wrote them, as in the old compiler). A component rendered in two contexts has two
instances of each of its routes, with different full patterns; an instance's id is the context's
id, `>>`, the template's id.

Most components render in one context, which the compiler then knows: their region ids are
constants and nothing is passed at run time. Only a component rendered in several contexts reads
its context from the hidden prop `route:context`, which its callers pass (after any spread, so it
wins) and which an element never takes as an attribute (`runtime/src/dom-props.ts`). It is added
to the component's props pattern, so it stays out of `...rest`. The old compiler passed a context
parameter to every route-owning component.

## Reading the route

`route` (`@memoized-dom/router`) is a facade whose getters report a read of one field
(`trackRouteRead`). A navigation publishes the key of each field whose value changed, so
`route.params.id` runs again when the params change and not when only the hash does. `params`,
`matches` and `matched` compare by value. `query` is one field, compared by the search string: a
stored `route.query` must change whenever any of it does, so a value derived from
`route.query.get('tab')` also runs again when another query key changes. The old compiler selected
literal query keys statically and skipped that run (`tests/r47-router-runtime.test.ts`, "updates
static route reads only when their selected values change"); the DOM is the same either way.

A navigation commits what it changed as it returns, as an event handler does (`enterCallback`);
inside a handler that navigates, the handler's return commits it. The DOM then updates when the
scheduler runs, as for any other write. The old compiler updated route regions synchronously
outside the scheduler, so old tests that assert right after `navigateRoute` with the default
scheduler differ by design.

## Preparations

`$routed(callback)` (`docs/16-routed.md`) is lowered in the same pass:

```tsx
export function Story() {                       $registerRoutedPreparation({ id: "./Story.tsx#routed:Story:0",
  const story = $routed(({ params }) => …);        server: false, prepare: ({ params }) => … });
  return <h1>{story.title}</h1>;                export function Story() {
}                                                 const story = $readRoutedPreparation("./Story.tsx#routed:Story:0");
```

- A route runs the preparations of the component it shows: the one its element calls, or for an
  element the component that writes it. Their ids go in the table entry's `metadata`, and the
  router runs them before the route commits (`router/src/preparation.ts`): the old page stays
  until the new one is prepared, and a returned `redirectRoute(…)` navigates instead.
- The callback moves to the top of the module, so it may not capture a binding of the component
  instance. It reads `params`, `query`, `routeState` and so on from its context.
- Reading `request`, `state`, `services` or `platform`, or a `#server/` import, makes it
  server-backed. With `routedEnvironment: 'client'` its body and the `#server/` imports only it
  reads are dropped, and the router asks the server for its value; a client build also waits for
  the first route's preparations (`await prepareInitialRoute()`) before anything mounts.
- `$fetch`, `$read` and server function calls inside it are settled where they are made
  (`withRoutedSources`, `await read(call)`), so it computes, caches and returns data.
- `readRoutedPreparation` reports a read of the route's location, so a navigation that keeps the
  page but prepares it again (a new query) shows the new value.
- In an application (a program with routes, or one that calls `mount`), a preparation no route
  runs is an error; a component compiled on its own may declare one.

Writing these found a bug in callback boundaries (`compiler/handlers.md`, "Callbacks"): a function
handed to unknown code that builds a value from a source lost the readiness records declared at the
top of its body, which it then used undeclared (`features/handlers/callbacks.test.ts`).

## Server-backed preparations end to end

Checked on 2026-11-14 with real builds and the real server, no new code needed:

- **the compiler's Bun plugin** (`packages/jsx-plus/tests/server.test.ts`, the directory app):
  the server renders `/people/2` with the value its preparation read from `#server/people`. A
  link click in the client sends `POST /_memoized/routed`. A client that starts on a
  server-rendered `/people/1` adopts the page with the value the server prepared: no request,
  and its nodes stay. Coming back to it later is a navigation, which asks again. Both optimization
  modes.
- **`packages/vite`** (`tests/next-plugin.test.ts`): the built server
  renders the page with its prepared value and answers `/_memoized/routed`. The client's chunks
  hold the endpoint and not the server-only module's data.

## A lazy route's styles

A route component's chunk brings its stylesheets when it runs. On a page the server rendered,
that is after the page shows, so the route's markup would show unstyled first. Built on
2026-11-14, split by the project's table (`project.md`, "Where they go"):

- **Compiler.** A server build plans the same splits as the browser's, and only names each split
  component in its table (`componentKey`, no loader; `split.ts`, `lower.ts`). The router skips a
  key with no loader. `compileModulesDetailed` reports `routeComponents` (key → module), and the
  project's build carries it.
- **Server.** `RenderSession.routeComponents()` reads the keys off the matched routes once they
  are prepared, before any HTML is sent (`render()` returns them, a stream's `prepared` resolves
  with them). `ServerIntegration.routeStyles` maps keys to stylesheet URLs, and
  `withRouteStyles` (`packages/server/src/route-styles.ts`) links the missing ones before
  `</head>`, or before the outlet when the template's prefix has no head.
- **Tool.** Vite's client build finds each key's chunk and its CSS, with the CSS of the chunks it
  imports (`generateBundle` in `packages/vite/src/plugin.ts`), and the production delivery
  module carries `routeStyles`. The compiler's generated `serve()` passes the delivery module's
  `routeStyles` on (`server/application.ts`). The command line needs none: Bun's HTML bundling
  links a lazy chunk's CSS in the page already.

Checked by `packages/vite/tests/next-plugin.test.ts`: the built server's page for `/profile` links
the route's own stylesheet in its head, and the home page does not. Also `split.test.ts` (the
server table and `routeComponents`) and `packages/server/tests/route-styles.test.ts`.

## Lazy route chunks

In a client build (`routedEnvironment: 'client'`), a component imported only to be shown by routes
loads with its route, not with the page (`docs/07-routing.md`, `features/routes/split.ts`):

```tsx
import { Profile } from './Profile';        (gone from the printed module)
<Profile route="/profile" />                createCompiledValue($readRouteComponent("./Profile.tsx#Profile"), …)

installRouteTable([{ …, metadata: { componentKey: "./Profile.tsx#Profile",
  moduleLoader: () => import("./Profile.tsx").then((m) => $registerRouteComponent("./Profile.tsx#Profile", m["Profile"])) } }]);
await $prepareInitialRouteModules();
```

- The bundler splits at the `import()`. The router (`router/src/route-modules.ts`) runs a route's
  loader before a navigation to it commits; the module holding the table waits for the first
  route's before anything mounts (`prepareInitialRoute` when there are preparations, which loads
  modules too). A lazy page's `$routed` preparation registers when its module evaluates, which is
  before the router runs it.
- The program is analyzed with the static import in place, so the component compiles exactly as an
  eager one. Only the printed importer changes, after linking: its import goes, and each use reads
  the component from the router when the route shows it.
- An import is split only when every use of its name is the tag of a route element, it names one
  export (not a namespace) of a program module, no other binding of the importer has its name, and
  no static import reaches the target from an entry except through split imports. A module the page
  loads anyway would only add a wait. A server build keeps every import: it renders any route at
  once.
- The loader's specifier is relative to the module that holds the table, with its extension, so it
  names one module wherever the import was written.

Writing the cases found two router bugs, both fixed (`packages/router`):

- **A table installed again kept the old table's metadata on the current route.** A new resolver
  whose matches had the same ids and params kept the old match objects, so a hot update or a fresh
  app went on running the old loaders and preparations until a navigation. A new resolver's matches
  now replace them, without notifying anyone, since no read changed (`runtime.ts`,
  `tests/compiled-table.test.ts`).
- **A cached lazy component was trusted for any table.** The module cache is shared across
  runtimes, keyed by the component's key, so a second table whose key named another module (an app
  evaluated again, two builds in one page) was shown the first one's component. A component is now
  reused only for the loader that loaded it; another loader loads its own, and the page on screen
  keeps reading the old one meanwhile (`route-modules.ts`, `tests/module-resource.test.ts`).

And one more found by the router's own suite: a compiled table was replayed onto every runtime
activated after it, including one created with routes of its own, so tests run after a table
test used the table's routes. A runtime given `routes` or a `resolver` now keeps them
(`own-routes.ts`); a server request's runtime, created without, still gets the table.

The harness's delivered run now renders from a server build (`routedEnvironment: 'server'`), as an
application's server does, and prepares the request's route before rendering
(`tests/harness/run.ts`). It had loaded the browser's build twice, which shared one router, so its
"server" render read the browser copy's lazy component.

## Base path

An application served below a prefix (`/app/`) declares it with the compiler's `base` option, which
the Vite plugin takes from Vite's own `base` when that is a path (2026-11-16). Route patterns stay
written from `/`; the prefix belongs to where the app is served, not to its routes.

- **Links** carry it: `<a route-to="/about">` compiles to `href="/app/about"`, and the root to
  `href="/app"`, so the `href` is right in server HTML, in a new tab and before any script runs.
  The object form writes `"/app" + buildRoutePath(…)`.
- **The router** reads route pathnames below it. The table gets it as a second argument,
  `installRouteTable([…], "/app")`, which calls the router's `setApplicationBasePath`
  (`packages/router/src/active-runtime.ts`): the runtime made before any application code ran
  (the browser's default one) reads its pathname again under the base (`replaceBasePath`,
  `runtime.ts`), and every runtime activated later gets it before the table, as a server request's
  does. A runtime with routes of its own keeps its own base, as it keeps its own routes.
  `navigate('/about')` writes the base in front; a link outside the base is a document navigation.
- **No base, or `/`**, adds nothing: the output is byte for byte what it was.
- A base must be a path (`./` and full URLs only place assets) with no parameter, wildcard, query
  or hash; anything else is a compile error.
- Checked in a browser: Common Ground served by Vite at `/cg/` loads, its links carry `/cg`, a
  click navigates in place, back returns and a deep link loads its page. Tests:
  `features/routes/routes.test.ts` (output) and `packages/router/tests/base-path.test.ts`
  (behaviour, in its own file: a base belongs to the process once declared).
- A runtime with no location yet (no page and no history: a server bundle installing its table as
  it loads, before any request) has only the fallback `/`, so a base moves it to the base's root
  instead of refusing it. Once a location is set, one outside the base is refused again (found by
  the Vite acceptance run, 2026-11-16).
- Not covered yet: server function endpoints (`/_fn/…`) and the server's own mounting below a
  base.

## Route types

`.memoized/routes.d.ts` gives the router's `RouteTable` the app's full patterns, so TypeScript checks
`route-to` and `navigate` against routes the app has: each pattern's `input` (what building a link
takes) and `params` (what the router reads back, always text). The route lowering reports every full
pattern, sorted and once each (`CompiledModules.routes`); `routeDeclarations` makes the file's text
and the application gives it as `ApplicationBuild.routeDeclarations`: null when the app has no
routes, undefined when the client failed to build, so a tool keeps the file it has. A tool only
writes the text (`../rules.md`, rule 17); `memoized-dom types` asks the Vite plugin to build for it.

## Rules

- `route` is a static string beginning with `/` on an element inside a component. A route element
  cannot also have `key`: its route keys it.
- Two routes the router could not tell apart (`/a/:x` and `/a/:y`, or `/` twice) are an error,
  unless one contains the other: `route="/"` inside a parent is the parent's own path, and the
  deeper route is the one a path shows.
- A catch-all cannot have child routes; a child cannot redeclare a parameter of its context.
- A component that renders routes cannot render itself.
- `route-to` goes on `<a>` only, with no `href` and no spread. Its target is a declared full
  pattern; with params it takes the object form `{ path, params, query, hash }`, params matching
  exactly.

## Testing

A case with routes sets `url`, its starting location (`tests/harness/case.ts`). Each observation
then records the location, so a link must navigate to the same place on the reference and in
compiled code. Each run gets a fresh route runtime; compiled code connects it itself (its route
table does), so a compiler that forgot to would show links that do not navigate. The reference
asks the router's public matcher which instance a path matches, and gives the router its own
matches so `route.params` means the same on both sides; which instance an element is, and what
it shows, is its own (`tests/reference/routes.ts`). It carries every route context on the calling
element rather than as a prop.

## Still to do

- A project's `stylesheets` still follows split imports, so a build-time page (no server) links a
  lazy route's stylesheet with the page's own.
- The reference settles no sources inside a preparation (its `$fetch` is its own), so cases with
  `$fetch` in `$routed` are compiled-only (`routed.dom.test.ts`).
