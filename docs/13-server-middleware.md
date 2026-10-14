# Server middleware

Create middleware with the application `define` object so its context is typed
without separate annotations:

```ts
export const session = define.middleware(async (context, next) => {
  context.state.user = await context.services.sessions.read(context.request);
  return next();
});
```

Request `state` is shared by reference across the middleware chain. A write in
one middleware is visible to every downstream middleware and handler, and is
still visible when control returns upstream after `await next()`.

Defining middleware does not apply it. Choose its scope explicitly:

```ts
app.use(logger);                         // every request
app.use('/api/admin/*', authenticated); // path group
app.post('/api/items', rateLimit, handler); // one raw route
```

Server functions retain two group conventions:

```ts
// server/functions/admin/_middleware.ts
export const middleware = [authenticated];
```

```ts
// server/functions/users.ts
export const middleware = [auditUsers];
```

Target one function by placing middleware beside its verb handler:

```ts
export const removeUser = define.function({
  middleware: [requireOwner],
  async delete({ services }, id: string) {
    return services.users.remove(id);
  },
});
```

The order is global middleware, path middleware, raw-route middleware,
ancestor function-folder middleware, module middleware, targeted middleware,
input validation, then the handler.

Next: [14 — server definition and services](./14-server-config.md)
