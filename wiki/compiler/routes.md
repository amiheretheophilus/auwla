# Routes

**Folders:** `features/routes/`; the router side is `packages/router/src/route-reads.ts`.

Status (2026-11-12): `route="…"` regions, `route-to` links, the route table and reads of `route`
are built, and a `suspend` route page whose param changes waits behind its pending policy (the
router scrolls once it commits). `$routed` preparations and splitting route-only imports into their
own chunks are still to do.

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
| `features/routes/routes.test.ts` | Output shape and every compile error |
| `tests/cases/routes.test.ts` | Behaviour compared with the reference's own lowering (`tests/reference/routes.ts`) |
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

- `$routed` preparations, their client/server split and `prepareInitialRoute`.
- Route-only imports as lazy chunks (`docs/07-routing.md`, nesting).
