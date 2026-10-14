# `createDefine()` — server authoring

The server should have one typed definition object shared by configuration,
middleware, services, server functions, ordinary HTTP routes, SSR, and
`$routed` preparations:

```ts
// server/define.ts
import { createDefine } from '@memoized-dom/server';

export interface State {
  requestId: string;
  user?: User;
}

export interface Platform {
  env: Env;
  executionCtx: ExecutionContext;
}

export const define = createDefine<State, Platform>();
```

The first type is application-owned, mutable request state. The optional
second type is the host platform supplied by a direct host adapter, delegated
`fetch`, or the `serve()` fallback.

For applications without a custom platform, the common form stays small:

```ts
export const define = createDefine<{
  foo: string;
}>();
```

Every server module imports this same `define`. The definition and the
capabilities created through it are the server contract.

## The boundary and project layout

The existing server root remains the hard server-only boundary:

```ts
// vite.config.ts
memoizedDom({
  clientEntry: 'src/main.ts',
  serverEntry: 'server.ts',
  server: 'server',
});
```

A typical project is:

```text
server.ts
server/
  define.ts
  middleware/
    authenticated.ts
  services/
    database.ts
    mailer.ts
  functions/
    _middleware.ts
    users.ts
    admin/
      _middleware.ts
      reports.ts
```

`server/functions` keeps its special meaning. It is where exported server
functions are discovered and converted into the generated client facade.
The other folders are organization only; middleware and services may be
split however the application prefers under the server-only root.

## Configuring `serve()`

`define` supplies the application contract and registered definitions.
`serve()` still owns runtime configuration:

```ts
// server.ts
import { serve } from '@memoized-dom/server';
import { define } from './server/define';
import { logger } from './server/middleware/logger';
import Main from './src/Main';

const app = serve({
  define,

  state: request => ({
    requestId: crypto.randomUUID(),
    user: undefined,
  }),

  platform: request => createDevelopmentPlatform(request),

  render: {
    mode: 'resolve',
    timeout: 2_000,
  },

  onError(error, { request, state }) {
    console.error(state.requestId, request.url, error);
    return new Response('Internal error', { status: 500 });
  },
});

app.use(logger);
app.ssr(Main);

export default app;
```

Passing `define` does not replace the rest of the `serve()` configuration.
The responsibilities are deliberately separate:

| Owner | Responsibility |
|---|---|
| `createDefine()` | Types and definitions shared by the whole server |
| `serve()` | Request-state construction, platform fallback, rendering, errors, routes, and host dispatch |

The `state` option runs for every
request and must return the state shape given to `createDefine()`.
`render`, `onRender`, `onError`, `app.use`, HTTP route methods, `app.ssr`, and
`app.fetch` remain application configuration rather than moving onto
`define`.

The host boundary also remains intact. A delegated backend can still provide
platform bindings for a request:

```ts
backend.all('*', context => app.fetch(context.req.raw, {
  platform: {
    env: context.env,
    executionCtx: context.executionCtx,
  },
}));
```

Dispatch-provided platform data wins over the `serve({ platform })` fallback.

## Request arguments

Handlers created from `define` receive one consistent first argument:

```ts
{
  request,
  url,
  params,
  state,
  services,
  platform,
}
```

| Field | Lifetime |
|---|---|
| `request`, `url`, `params` | The active request and matched route |
| `state` | Mutable and new for every request |
| `services` | Shared and initialized once per `serve()` application |
| `platform` | Supplied by the host or created per request |

Authoring receives request values through handler arguments. The server runtime
maintains an internal request scope for SSR, nested in-memory dispatch, and
request isolation.

## Services

A service is a named, application-scoped dependency:

```ts
// server/services/database.ts
import { define } from '../define';

export const database = define.service('database', async () => {
  return createDatabase(process.env.DATABASE_URL);
});
```

Export the returned definition directly for automatic discovery. The exported
`database` is a service definition, not the initialized database. Vite discovers
these exports in ordinary modules under the server root and imports them into
the server application; an unexported declaration or a bare `define.service()`
call is not automatically discovered. The `services/` folder is organization
only, while `functions/` is reserved for client-callable functions.

During dev/build, Vite generates the server registry. Include
`.memoized/**/*.d.ts` in your tsconfig to make the resolved service types
available through handler contexts. Functions, middleware, ordinary routes,
and server-backed `$routed` callbacks receive typed `services` without importing
each definition or maintaining a separate services interface:

```ts
services.database;
```

Service-to-service dependencies are explicit so initialization never depends
on module evaluation order:

```ts
// server/services/mailer.ts
import { define } from '../define';
import { database } from './database';

export const mailer = define.service('mailer', {
  dependencies: { database },

  create: async ({ database }) => {
    return createMailer({
      database,
      apiKey: process.env.MAIL_API_KEY,
    });
  },
});
```

`serve()` resolves that graph automatically. It initializes each service at
most once per application instance, deduplicates concurrent initialization,
and reports duplicate names, missing dependencies, and dependency cycles.
A failed initialization is not cached permanently; a later request may retry.

Service factories can use other declared services and process-level
configuration, but they do not receive request `state` or `platform`. A shared
service must not capture data from whichever request happened to initialize it.

The fully resolved service object is injected into middleware, functions,
routes, SSR work, and server-backed `$routed` callbacks:

```ts
const user = await services.database.users.find(id);
await services.mailer.sendWelcome(user);
```

There is no `use(database)` call in ordinary handlers.

## Middleware

`define.middleware()` creates middleware with the correct state, service, and
platform types:

```ts
// server/middleware/authenticated.ts
import { define } from '../define';

export const authenticated = define.middleware(
  async ({ request, state, services }, next) => {
    state.user = await services.database.sessions.authenticate(request);

    if (state.user === undefined) {
      return new Response('Unauthorized', { status: 401 });
    }

    return next();
  },
);
```

Defining middleware does not apply it globally. It is an ordinary exported
value which can be placed at the existing scopes.

Global and path middleware remain on the application:

```ts
app.use(logger);
app.use('/api/admin/*', authenticated);
```

Folder middleware remains available to a server-function subtree:

```ts
// server/functions/admin/_middleware.ts
import { authenticated } from '../../middleware/authenticated';

export const middleware = [authenticated];
```

Module middleware applies to every server function in one file:

```ts
// server/functions/users.ts
import { authenticated } from '../middleware/authenticated';

export const middleware = [authenticated];
```

The compiler treats the special `middleware` export as module configuration,
not as a server function or client-facade export.

## Server functions

Declare an HTTP verb handler inside `define.function`:

```ts
// server/functions/users.ts
import { define } from '../define';
import { authenticated } from '../middleware/authenticated';

export const middleware = [authenticated];

export const getUser = define.function({
  async get({ state, services }, id: string) {
    return services.database.users.findFor(id, state.user);
  },
});

export const createUser = define.function({
  async post({ state, services }, input: CreateUserInput) {
    const user = await services.database.users.create(input, state.user);
    await services.mailer.sendWelcome(user);
    return user;
  },
});
```

Each definition has exactly one `get`, `post`, `put`, `patch`, or `delete`
handler. When declared, the first argument is injected by the server and is not
part of the client contract. Without a schema, the remaining named arguments
are transported. Client code calls the generated facade without constructing
server context:

```ts
import { createUser, getUser } from '#server-functions';

const user = getUser(selectedId);
await createUser({ name, email });
```

`get`, `post`, `put`, `patch`, and `delete` select the HTTP method.

Validation is optional. Without `input`, annotate transported arguments as
ordinary TypeScript parameters. A handler with no inputs can omit its context
parameter entirely:

```ts
export const getStories = define.function({
  async get() {
    return loadStories();
  },
});
```

Add `input` or targeted `middleware` beside the verb when needed:

```ts
export const removeUser = define.function({
  middleware: [requireOwner],
  input: removeUserInput,

  async delete({ services }, input) {
    return services.database.users.remove(input.id);
  },
});
```

With a schema, `input` is the one transported value: the client accepts
the schema input type and the handler receives its validated output. The
definition's middleware is targeted only at `removeUser`. It adds to rather
than replaces inherited middleware. The complete order is:

```text
app.use global
→ app.use path group
→ raw-route middleware
→ ancestor _middleware.ts files
→ module `middleware` export
→ targeted function middleware
→ input validation
→ handler
```

A schema may describe a scalar as well as an object. The client call uses the
schema input type, and the second handler argument uses its output type:

```ts
export const getUser = define.function({
  input: userIdSchema,
  async get({ services }, id) {
    return services.users.find(id);
  },
});

getUser(userId);
```

Schema-backed GET calls JSON-encode the one input into a query parameter;
mutations send it as the JSON body. The validator receives the original JSON
types, including scalar numbers, booleans, arrays, and objects.

`server/functions` is the server-only discovery boundary. Client code accesses
the generated facade through `#server-functions`.

## Ordinary HTTP routes and SSR

The application returned by `serve()` keeps its route API:

```ts
app.get('/api/users/:id', authenticated, async ({ params, services }) => {
  return services.database.users.find(params.id);
});

app.post('/api/users', authenticated, async ({ request, state, services }) => {
  const input = await request.json() as CreateUserInput;
  return services.database.users.create(input, state.user);
});
```

These handlers receive the same state and services as server functions.
`define.function` is specifically for compiler-generated, client-callable
operations; it does not replace ordinary HTTP routes.

SSR registration also stays with the application:

```ts
app.ssr(Main);
app.ssr('/docs/*', Docs, { delivery: 'buffer' });
```

Rendering, route preparation, middleware, and server functions all run inside
the same request scope and therefore see the same `state`, `services`, and
`platform` values.

## `$routed`

`$routed` receives the same server values when its callback is server-backed:

```tsx
export function Account() {
  const account = $routed(async ({ params, state, services, signal }) => {
    const user = state.user;
    if (user === undefined) return redirectRoute('/login');

    return services.database.accounts.find(params.id, user.id, { signal });
  });

  return <h1>{account.name}</h1>;
}
```

Reading `request`, request `state`, `services`, or `platform` makes the
preparation server-backed. Its body remains on the server and only its
serializable result crosses the boundary.

There are two different kinds of state involved in routing, so they need
different names:

| Name | Meaning |
|---|---|
| `state` | Server request state created by `serve({ state })`; server-only and fresh per request |
| `routeState` | Preparation-owned state that persists across navigations and can transfer through SSR |

The existing universal `$routed` preparation state therefore becomes
`routeState`:

```tsx
const page = $routed(({ params, routeState }) => {
  routeState.visits = (routeState.visits as number | undefined ?? 0) + 1;
  return { id: params.id, visits: routeState.visits };
});
```

A server-backed preparation can use both without ambiguity:

```tsx
const page = $routed(async ({ params, state, routeState, services }) => {
  routeState.lastId = params.id;

  return services.database.pages.findVisibleTo(
    params.id,
    state.user,
  );
});
```

The complete proposed `$routed` argument is:

```ts
{
  // Universal navigation values
  url,
  params,
  query,
  signal,
  routeState,

  // Server-only request values
  request,
  state,
  services,
  platform,
}
```

## Server authoring contract

The application uses:

- the configured server-only root;
- the special `server/functions` discovery folder;
- generated `#server-functions` client facades;
- `_middleware.ts` inheritance and module `middleware` exports;
- `serve()` runtime, rendering, host, error, route, and middleware configuration;
- internal request scoping required for SSR and nested dispatch.

The result is one authoring vocabulary: create the central `define`, use it to
declare server capabilities, pass it to `serve()`, and receive the same typed
request values everywhere the server executes application code.
