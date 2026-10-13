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

Factories receive declared service dependencies only. They do not receive
request `state` or `platform`, because a shared service must not retain data
from whichever request initialized it. Read request values from handler or
middleware context instead.

When using `@memoized-dom/server` without the Vite integration, import service
modules before calling `serve()` so their declarations register on `define`.

Next: [15 — server context](./15-server-context.md)
