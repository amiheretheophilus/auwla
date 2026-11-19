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

Open `/desk` and enter the staff email and password. The setup command applies Better Auth's SQLite migrations and creates the first staff account, an admin. It leaves existing accounts and analyses in place. Add more staff with:

```sh
bun run --cwd triaxis auth:add-analyst "Ama Mensah" ama@example.com          # an analyst
bun run --cwd triaxis auth:add-analyst "Kofi Boateng" kofi@example.com admin   # an admin
```

The command asks for the password, so it stays out of the shell history.

The sign-in form uses Auwla's `$forms` helper with the typed `login` function in `server/functions/login.ts`. The same sign-in and sign-out handlers are mounted through Hono under `/api/auth`. Better Auth manages password hashing and session cookies. Staff have the `admin` or `analyst` role, declared in `server/auth/auth.ts`.

### Analyses

Each trade idea is an analysis with one author. `/desk` lists every analyst's analyses, newest first, with status tabs (ready to post, rejected, incomplete, posted) and filters for analyst, market, asset and date. Rejected analyses stay in the list with the check that stopped them. `/desk/analyses/:id` opens one. Everyone on the staff can read every analysis; only its author or an admin can change or post it.

The editor runs the checks in the browser as the analyst types, using the same rules as the server (`src/desk/draft/model/signal-checks.ts`). The server runs them again on every save and inside the posting transaction, so the browser's result is only a preview. The checks look at price order and compare the distance from entry to the target with the distance from entry to the stop. They use TP2 when present and TP1 for a single target. Only TP1 is required: empty target rows after the last price are ignored, while a blank row between prices still needs a price. Risk is optional draft data and the percentage has no upper limit.

Post stays disabled until the saved version passes every check and there are no unsaved changes. Posting stores the card in `published_signals` with a `TRX-0001` style ID. Its unique key makes a repeated Post return the first signal, and a posted analysis can no longer change.

Auth and analyses use Bun SQLite at `.local/analyst.sqlite`. Set `TRIAXIS_DESK_DB` to use a different server-side path outside `public/`. The Neon connection backs `/readyz`.

Desk components are grouped under `src/desk/auth`, `src/desk/layout`, `src/desk/board` (the list), `src/desk/draft` (the editor, its fields and the check rules) and `src/desk/payments`. Server code is in `server/desk/analyses.ts` and `server/functions/desk.ts`.

## Members

Visitors see the plans before making an account, on `/pricing` and in the landing page's Plans section. Choosing one carries it as `?plan=` through sign-up (or sign-in) straight to checkout, with that plan already picked.

Visitors create an account at `/sign-up` and sign in at `/sign-in`. Better Auth only accepts requests from the addresses it trusts: `BETTER_AUTH_URL`, both `127.0.0.1` and `localhost` on that port when running locally, and any listed in `BETTER_AUTH_TRUSTED_ORIGINS`. A refused address gets a clear message and a server log line naming it. New accounts get the plain `user` role, so they can never open the desk, and the staff sign-in at `/desk/sign-in` refuses them. **Email verification is off while testing** (`requireEmailVerification: false` in `server/auth/auth.ts`); turn it on together with an email sender. Staff can sign in on the member pages too.

`/app/subscribe` sells the plans in `src/members/plans.ts`. Only the two prices the owner has given are on sale: one axis for 1 month ($35) and all three axes for 3 months ($100). The other lengths are listed without a price and stay hidden until the owner sets them. The member picks a plan (and an axis for a single-axis plan), pays by bank, mobile money or USDT using the details in `TRIAXIS_PAY_BANK`, `TRIAXIS_PAY_MOBILE_MONEY` and `TRIAXIS_PAY_USDT`, and submits the payment reference. A member can have three payments waiting at once.

An admin approves or rejects each payment at `/desk/payments`. A payment is decided once; approving it adds the plan's months to each axis it covers, starting where the member's current access ends, so a renewal adds time on top. Admins hold every axis for life.

`/app` shows the member's axes, held or locked, any payment waiting, and the posted signals on the axes they hold, newest first, with the levels as copyable text. Which signals a member may see is decided on the server (`server/members/access.ts`); a locked axis sends none of its signals to the page. Member code is in `src/members` and `server/members`; the server functions are in `server/functions/members.ts`.

Not built yet: expiry reminders, revoking access, upgrade pricing, Google and phone sign-in, and referral codes.

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
