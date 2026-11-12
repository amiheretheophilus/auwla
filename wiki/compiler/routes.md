# Routes

**Folders:** `features/routes/`; the router side is `packages/router/src/route-reads.ts`.

Status (2026-11-12): `route="…"` regions, `route-to` links, the route table, reads of `route` and
`$routed` preparations are built, and a `suspend` route page whose param changes waits behind its
pending policy (the router scrolls once it commits). A client build loads a component imported only
for its routes with its route ("Lazy route chunks"). Server-backed preparations end to end (they
need the server and Vite), and a lazy route's styles on a server-rendered page, are still to do.

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
  consumed), and null otherwise. compiler-next runs a call it cannot see into inside a tracked
  computation, and the router reports the read there (`route-reads.ts`), so the region follows
  navigation with no special case in the compiler.
- Keying the content by that identity remounts it on a new path: `/story/1` → `/story/2` starts
  `Story` afresh, while a layout above it stays mounted. A query or hash change keeps it.
- `route-to` becomes `href`; with params, a query or a hash it is built by the router's
  `buildRoutePath`. The router's click handler makes a click on it navigate in place.
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
| `features/routes/patterns.ts` | Pattern rules: leading `/`, no query/hash/empty segment, terminal `*`, unique params |
| `features/routes/routed.ts` | `$routed` calls: their checks, server classification and the sources they make |
| `features/routes/routes.test.ts` | Output shape and every compile error, routes and `$routed` |
| `features/routes/routed.dom.test.ts` | Sources made inside a preparation are settled before it caches or returns them |
| `features/routes/split.ts` | Lazy route chunks: which imports load with their routes (`planRouteSplits`), and the printed importer's swap (`splitRouteImports`) |
| `features/routes/split.test.ts` | Which imports split and which stay, and the loader each table entry gets |
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

- A lazy route's styles on a page the server renders: the first route's chunk loads its CSS only
  when its script runs, after the page shows (`project.md`, "Where they go"). A project's
  `stylesheets` also still follows split imports, which matters only once it does.
- Server-backed preparations end to end: the server endpoint and SSR delivery of prepared values,
  with `packages/vite`.
- The reference settles no sources inside a preparation (its `$fetch` is its own), so cases with
  `$fetch` in `$routed` are compiled-only (`routed.dom.test.ts`).
