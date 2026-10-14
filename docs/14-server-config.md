# Server definition and services

`server/define.ts` is the central server contract:

```ts
import { createDefine } from '@memoized-dom/server';

export const define = createDefine<RequestState, HostPlatform>();
```

The Vite integration reads this module and augments server, router, middleware,
and `$routed` types. No parallel interface needs to mirror the application.

Declare application-scoped services anywhere under the server root:

```ts
// server/services/database.ts
import { define } from '../define';

export const database = define.service('database', async () => {
  return connectDatabase(process.env.DATABASE_URL);
});
```

For automatic discovery, export the returned definition directly as shown
above. An unexported declaration or a bare `define.service(...)` call is not
automatically discovered. `server/services/` is an organizational convention,
not a required folder name; these declarations belong in ordinary server
modules, outside the client-callable `server/functions/` directory.

The exported `database` value is a service definition, not the initialized
database. Handlers receive the resolved database through `services.database`.
They do not import the definition or repeat its type:

```ts
// server/functions/users.ts
import { define } from '../define';

export const getUsers = define.function({
  async get({ services }) {
    return services.database.users.findAll();
  },
});
```

Dependencies are explicit values, so their types and initialization order are
known without a central assembly function:

```ts
import { database } from './database';

export const mailer = define.service('mailer', {
  dependencies: { database },
  create: ({ database }) => createMailer(database),
});
```

The build discovers exported service declarations, imports their modules into
the server application, and generates the `services.database` and
`services.mailer` types. At runtime each service is initialized lazily at most
once per `serve()` application. Concurrent requests share initialization;
failed initialization may retry. Duplicate names and dependency cycles fail
with a diagnostic.

Vite generates the shared service typings during dev/build. Each resolved
service type is available through the injected `services` context in server
functions, `define.middleware()` handlers, ordinary HTTP routes, and
server-backed `$routed` callbacks. Your tsconfig must include
`.memoized/**/*.d.ts` so the generated registry participates in type checking.
This does not create global service variables or expose services to browser
code.

Factories receive declared service dependencies only. They do not receive
request `state` or `platform`, because a shared service must not retain data
from whichever request initialized it. Read request values from handler or
middleware context instead.

When using `@memoized-dom/server` without the Vite integration, import service
modules before calling `serve()` so their declarations register on `define`.

Next: [15 — server context](./15-server-context.md)
