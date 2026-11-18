# Triaxis

The member web app and staff panel live in this Auwla workspace. Vite builds the browser assets and the Bun server from one configuration. The first page is the public market overview. See [the product brief](brief.md) for the signal desk and later workflows.

## Local development

Use the Bun and Node versions declared in the repository root. On a fresh checkout, install dependencies and build the local Auwla packages from the repository root.

```sh
bun install
bun run build
bun run --cwd triaxis dev
```

Open `http://127.0.0.1:3070`. The overview runs without a database connection. To connect Neon, copy `.env.example` to `.env` in this directory and set `DATABASE_URL` to the connection string for a development branch. Leave the connection string in the server environment.

## Local analyst desk

Set `BETTER_AUTH_SECRET` and the local staff account's `TRIAXIS_ANALYST_EMAIL` and `TRIAXIS_ANALYST_PASSWORD` in `triaxis/.env`. Use separate random values for the secret and password. The default local origin is `http://127.0.0.1:3070`. Set `BETTER_AUTH_URL` to the app's origin when using another port or host.

```sh
bun run --cwd triaxis auth:setup
bun run --cwd triaxis dev
```

Open `/desk` and enter the staff email and password. The setup command applies Better Auth's SQLite migrations and creates the local staff account. It leaves existing accounts and drafts in place. The local desk has one analyst workspace and one active draft.

The sign-in form uses Auwla's `$forms` helper with the typed `login` function in `server/functions/login.ts`. The same sign-in and sign-out handlers are mounted through Hono under `/api/auth`. Better Auth manages password hashing and session cookies. Local staff accounts use the `admin` role.

The desk route uses a server-backed `$routed` preparation to check the staff session and load the draft. The editor supports an editable list of take-profit targets. Saving checks price order and compares the distance from entry to the target with the distance from entry to the stop. It uses TP2 when present and TP1 for a single target. Risk is optional draft data and the percentage has no upper limit. Auth and drafts use Bun SQLite at `.local/analyst.sqlite`. Set `TRIAXIS_DESK_DB` to use a different server-side path outside `public/`. The Neon connection backs `/readyz`.

Desk components are grouped under `src/desk/auth`, `src/desk/layout`, and `src/desk/draft`. The draft folder groups its fields and data model separately.

## Add a feature

- Put page components and browser behavior in `src/`.
- Put browser-callable functions in `server/functions/` using the shared `define` from `server/define.ts`. Import those functions from `#server-functions` in components. The Vite plugin generates that module and its declarations.
- Put SQL in server-side modules that use `server/database.ts`. Keep database access and other private server logic in `server/`.
- Register HTTP and SSR routes in `server.ts`. The overview uses `app.ssr('/', App)`.

Run `bun run --cwd triaxis check` after editing. It regenerates the server function types and checks TypeScript and `.auwla` source.

## Production build

Run these commands from the repository root after building the workspace packages.

```sh
bun run --cwd triaxis build
bun run --cwd triaxis start
```

Keep `dist/server.js` and the rest of `dist/` together. Set `DATABASE_URL` and `PORT` in the hosting environment. The start command sets `NODE_ENV=production`. The server connects to Neon on demand.

| Route | Check |
| --- | --- |
| `GET /healthz` | Returns `200` when the server can handle requests |
| `GET /readyz` | Returns `200` when Neon answers `SELECT 1`, or `503` when the connection is unavailable |
