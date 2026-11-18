# Server functions

To return server-owned JSX regions instead of application data, see
[Server-owned components through `page(...)`](./server-components-design.md).
That guide covers finite results, live updates, local interactions, and limits.

## The `server` field

The vite plugin takes one more option besides `clientEntry`/`serverEntry`:

```ts
// vite.config.ts
memoizedDom({
  clientEntry: 'src/main.ts',
  serverEntry: 'server.ts',
  server: 'server',        // server-only root — the default
});
```

`server` names a folder that is **server-only territory** — nothing under
it is compiled into or reachable from the client bundle. Rename it
(`server: 'backend'`) and the conventions follow it. Inside that root,
the `functions/` subfolder is where server functions live:

```
server/
  functions/
    stories.ts
    users.ts
```

One tsconfig addition so TypeScript can resolve the special imports this
feature uses:

```jsonc
{
  "compilerOptions": {
    "paths": {
      "#server/*": ["./server/*"],
      "#server-functions": ["./.memoized/server-functions.d.ts"]
    }
  },
  "include": ["src", ".memoized/**/*.d.ts"]
}
```

`#server-functions` is how client code reaches those functions. The
function bodies stay on the server — they never ship to the browser. What
the client imports is a generated facade: same names, same parameters,
same return types, but calling it fires an HTTP request instead of
running the real code.

It's also not a real file on disk — it's a virtual module the plugin
resolves at build time. The `paths` entry above points TypeScript at the
generated `.memoized/server-functions.d.ts` declarations (written on
dev/build), so the calls are fully typed end to end: rename a function or
change a parameter and the client call sites fail typecheck, not runtime.


Files under the configured `server/functions` directory expose client-callable
HTTP operations. Declare each export through the shared `define` object:

```ts
// server/functions/users.ts
import { define } from '../define';

export const getUser = define.function({
  async get({ state, services }, id: string) {
    return services.database.users.findFor(id, state.user);
  },
});

export const createUser = define.function({
  async post({ state, services }, input: CreateUserInput) {
    return services.database.users.create(input, state.user);
  },
});
```

Each definition declares exactly one HTTP verb handler. When present, the
first parameter is injected on the server. It is never serialized and the
client does not pass it. Without a schema, every remaining parameter must be a
named identifier; those parameters form the transport contract.

Client code imports the generated facade:

```ts
import { createUser, getUser } from '#server-functions';

const user = getUser(selectedId);
await createUser({ name, email });
```

`get` arguments use query encoding. `post`, `put`, `patch`, and `delete`
arguments use a JSON body. The verb handler supplies executable metadata to
the compiler and language service.

Validation is optional. Add a schema only when the operation needs it, and put
targeted middleware beside the handler:

```ts
export const removeUser = define.function({
  middleware: [requireOwner],
  input: removeUserInput,
  async delete({ services }, input) {
    return services.database.users.remove(input.id);
  },
});
```

`input` is the single transported value in this form. The client accepts the
schema input type and the handler receives the validated schema output type.
The existing folder `_middleware.ts` files and a module-level
`export const middleware = [...]` still apply to groups of functions.

For an operation with no context or transported inputs:

```ts
export const getStories = define.function({
  async get() {
    return loadStories();
  },
});
```

Schemas can validate a scalar as well as an object:

```ts
export const getUser = define.function({
  input: userIdSchema,
  async get({ services }, id) {
    return services.users.find(id);
  },
});

getUser(userId);
```
## Transport and tracking

GET calls return the same transparent data source as `$fetch`; reactive
arguments rerun the read, and `$track` exposes pending state, errors, and
refresh. Mutations return a `Promise` of their result (see
[Pending and errors for a mutation](#pending-and-errors-for-a-mutation)), and
must run from event handlers, effects, or deferred callbacks. Calling them during render or module evaluation is a compile error.

Without a schema, mutation arguments form a JSON object keyed by parameter
name. With a schema, the client's one input argument is the complete
JSON body. Schema-backed GET calls JSON-encode the input into the `input` query
parameter, preserving its JSON types before validation. Schema output is passed
directly to the handler, including transformed values and defaults. Validation
issues return HTTP 400 with `error: 'invalid_server_function_input'` and `issues`.

Names must be unique across the flat `#server-functions` barrel. HTTP handlers
must be inline and async. The injected context and schema input may be
destructured. Transported parameters without a schema must be named identifiers.

## WebSocket rooms

Use `websocket` as the handler when the same connection should read a room,
send changes, and receive updates. The `live` callback chooses the room from
the same server context and arguments that the handler receives. Declare the
handler first so TypeScript can infer the positional arguments in `live`.
Every connection to this function that returns the same key joins the same
group, even when its connection arguments differ.

```ts
export const chat = define.function({
  async websocket({ state, services }, channel: string) {
    if (!state.user) return new Response('Sign in first', { status: 401 });

    return {
      initial: () => services.chat.history(channel),
      message(text: string) {
        return services.chat.add(channel, state.user.id, text);
      },
    };
  },
  live: (_context, channel) => ['chat', channel],
});
```

```ts
import { $track } from '@memoized-dom/data';
import { chat } from '#server-functions';

const room = chat('design');
const stop = room.onMessage(value => showChatUpdate(value));
const history = await room.ready;
const receipt = await room.send('Ready for review');
const status = $track(room).status;

// When leaving the room or disposing its owner:
stop();
room.close();
```

- Middleware, services, and `input` validation run during the upgrade. Keep
  confidential data out of connection arguments because browsers send them in
  the upgrade URL. Validate each incoming message in `message` before using it.
- `initial` can be a value or an async reader. Only the joining connection
  receives it. A lazy reader runs in order with messages in the room.
- A returned message reaches every connected client in the room, including
  the sender. `send()` also resolves with the handler's result. Return
  `replyToSocket(value)` from `@memoized-dom/server` for a sender-only result,
  or return `undefined` to acknowledge without broadcasting.
- `ready` resolves with the first initial value. `onMessage` receives the initial
  value, public updates, and a fresh initial value after reconnecting. `$track`
  exposes `status` (`connecting`, `open`, `closed`, `error`) and `error`.
  An interrupted `send()` rejects because the server may already have handled it.
- Open the connection in browser setup or an event handler and call `close()`
  when the connection's owner goes away. `close` on the server session is an
  optional hook for releasing resources. A value it returns is sent to the
  remaining room members. SSR renders without opening a socket.

Bun and Node host rooms within the server process. The Cloudflare CLI build
generates a `MEMOIZED_WEBSOCKETS` Durable Object binding and migration. With
custom Worker configuration, bind that name to the generated
`MemoizedWebSocketHost` class and add it to `new_sqlite_classes`. The object keeps
its sockets awake because sessions can hold application closures.

## Status, cookies, and errors

A server function can return a normal Web `Response`, just like an HTTP route.
The optional `json()` helper is a short, typed way to create one:

```ts
import { json } from '@memoized-dom/server';

export const postLogin = define.function({
  async post(_context, email: string, password: string) {
    const session = await authenticate(email, password);
    if (session === null) {
      return json({ error: 'invalid_credentials' }, { status: 401 });
    }
    return json({ user: session.user }, {
      status: 201,
      headers: { 'set-cookie': session.cookie },
    });
  },
});
```

`json()` returns a native `Response`; it has no special server-function
behavior. Its only extra benefit is TypeScript inference of the JSON body
on generated client calls. It works identically in ordinary routes
(`app.get('/health', () => json({ ok: true }))`) and middleware. Raw
`Response.json()` works too.

The server sends the response unchanged. The browser handles `Set-Cookie`;
the client facade decodes the body as it does for other `$fetch` calls. With
`json()`, the client value retains the JSON body's TypeScript type. With a raw
`Response`, the client value is typed `unknown` because TypeScript cannot
infer its body shape. On a non-2xx response, `$track(call).error` is a
`RequestError` with `status` and
the decoded body in `data`. When that body is JSON with a `message` string,
it is the error's message, for live functions too, so a form or a Group's error
policy shows it directly:

```ts
if (user === null) return json({ message: 'Email or password is invalid' }, { status: 401 });
```

Return expected failures this way. Unexpected thrown exceptions still go through
`serve({ onError })` and reach the client as a private 500, never exposing
their details.

## Mutations return the data — reconcile, don't refetch

A mutation's return value is the server's truth for what it changed.
`postNote` returns the created note, `postVote` returns the new vote count
— use that to reconcile local state:

```ts
import { optimistic } from '@memoized-dom/utils';

const saveNote = optimistic({
  action: (text: string) => postNote(expeditionId, text),
  apply(text, operationId) {
    notes.push({ id: operationId, text, by: 'you' });
    return () => {
      const index = notes.findIndex(note => note.id === operationId);
      if (index !== -1) notes.splice(index, 1);
    };
  },
  reconcile(saved, _text, operationId) {
    const index = notes.findIndex(note => note.id === operationId);
    if (index !== -1) notes.splice(index, 1, saved);
  },
});

lastPost = saveNote(text);
```

`optimistic()` applies the temporary change immediately and owns the rollback
and reconciliation for each operation. Its unique operation ID keeps
overlapping submissions distinct. It returns the original server-function
result, a `Promise`: await it, or pass the action to `$forms` (below) for
submission state.

For forms, pass the returned action to `$forms`:

```tsx
const form = $forms((fields: FormData) =>
  saveNote(String(fields.get('text') ?? '')),
);

return <form onSubmit={event => form.submit(event)}>
  <input name="text" />
  <button type="submit" disabled={form.pending}>Save note</button>
</form>;
```

`$forms` owns validation and submission state; `optimistic` owns the immediate
change and rollback.

For repeated updates to the same resource, pass a grouping ID on each call:

```ts
const castVote = optimistic({
  action: (id: number) => postVote(id),
  apply(id) {
    const story = stories.find(story => story.id === id);
    if (story !== undefined) story.votes++;
    return () => {
      if (story !== undefined) story.votes--;
    };
  },
  reconcile(saved) {
    const story = stories.find(story => story.id === saved.id);
    if (story !== undefined) story.votes = saved.votes;
  },
});

lastVote = castVote(story.id, { id: story.id });
```

Rapid clicks for one story still update immediately. Reconciliation waits for
all pending calls with that ID, then applies the most recently started
successful call's result once. Different story IDs settle independently, and
each failure keeps its own rollback. The grouping ID is optional; omit it for
independent operations such as inserting separate notes. Each request retains
its own operation ID, and `lastVote` is still that request's `Promise`.

Refetching after every mutation would waste a round trip for data you
already have. `refresh()` is for the rarer case — a write that changes
state owned by a *different* source (a count, an aggregate) whose inputs
you can't reconcile locally.

## Pending and errors for a mutation

A read and an action come back differently. A GET call returns a data
source, which you render and `$track` (`pending`, `error`, `refresh()`). A
mutation (`post`, `put`, `patch`, `delete`) runs once, when your handler calls
it, and returns a **`Promise` of its result**, as the generated
`#server-functions` types say. `$track` takes data sources and forms, not
promises: `$track(postVote(id))` is a type error and would observe nothing,
since the request is released once it settles.

In a form, `$forms` owns the submission state:

```tsx
import { createNote } from '#server-functions';

const form = $forms((fields: FormData) => createNote(String(fields.get('text') ?? '')));

return <form onSubmit={(event) => form.submit(event)}>
  <input name="text" />
  <button type="submit" disabled={form.pending}>Save note</button>
  {form.errors.length > 0 ? <p>{form.errors[0]!.message}</p> : null}
</form>;
```

`form.pending`, `form.errors` and `form.result` follow the latest submission,
and `$track(form)` adds `onSuccess`/`onError`.

Anywhere else, await the call. Pending and failure are ordinary variables,
which the compiler makes reactive like any other:

```tsx
import { getStories, postVote } from '#server-functions';

export function App() {
  const stories = getStories();
  let voting = false;
  let failed = '';

  async function vote(id: number) {
    voting = true;
    failed = '';
    try {
      const saved = await postVote(id);          // the POST, once
      const story = stories.find((story) => story.id === saved.id);
      if (story !== undefined) story.votes = saved.votes;
    } catch (error) {
      failed = String(error);
    } finally {
      voting = false;
    }
  }

  return (
    <div>
      <ul>
        {stories.map((s) => (
          <li key={s.id}>
            {s.title}
            <button disabled={voting} onClick={() => vote(s.id)}>Vote</button>
          </li>
        ))}
      </ul>
      {failed !== '' ? <p>Vote failed: {failed}</p> : null}
    </div>
  );
}
```

The POST response supplies the updated vote data. Applying it to the existing
story updates the UI without issuing another GET request. For immediate
feedback before the response arrives, use `optimistic()` with the same
reconciliation logic.

Next: [13 — Server middleware](./13-server-middleware.md)
