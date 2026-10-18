# Memoized DOM CLI

`@memoized-dom/vite` installs the `memoized-dom` command. It uses the normal
`vite.config.ts` to compile the application, run development, generate project
types, and build for production.
Reusable libraries use `memoized-dom package` and a single `.lib.config.ts`
instead; that flow does not load an application Vite configuration.

Applications can also opt ordinary installed ESM dependencies into compilation
with [`compilePackages`](./third-party-package-compilation.md#consumer-workflow-compile-an-installed-dependency)
in their existing Vite plugin configuration. The same `dev`/`build` commands
collect, compile and cache those dependencies; no separate package command is
needed for them.

## One command shape

Use the same scripts for browser-only, Bun, Node, and Cloudflare applications:

```json
{
  "scripts": {
    "dev": "memoized-dom dev",
    "build": "memoized-dom build"
  }
}
```

Run them with your package manager:

```sh
bun run dev
bun run build
```

`npm run dev` and `npm run build` work too. Users do not need to change these
scripts when changing the configured host.

## Runtime selection

Configure the application target in the Vite plugin:

```ts
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  plugins: [memoizedDom({
    clientEntry: 'src/main.ts',
    serverEntry: 'server.ts',
    runtime: 'bun',
  })],
});
```

| Configuration | Development behavior |
|---|---|
| No `serverEntry` | Vite serves the browser application. |
| `runtime: 'bun'` | The CLI launches Bun; Vite transforms the backend and Bun owns the native listener. |
| `runtime: 'node'` | The CLI launches Node; Vite transforms the backend and Node owns the native listener. |
| `runtime: 'cloudflare'` | Node runs the tooling; the Cloudflare plugin runs the backend in `workerd`. |

Bun is the default target when `serverEntry` is present. Node is required for
configuration discovery and builds; Bun must also be installed and on PATH
when selected. The CLI hands execution to the selected host automatically,
preserving the working directory, arguments, and environment. There is no need
to force `--bun` or invoke the CLI file through `node` yourself.

Cloudflare applications still configure `cloudflare()` from
`@memoized-dom/vite/cloudflare` and their Wrangler settings. The CLI does not
replace Worker bindings or deployment configuration. See
[SSR — Cloudflare Workers](./09-ssr.md#cloudflare-workers).

## `dev`

```sh
memoized-dom dev
```

With a server entry, the backend owns the public listener. A private Vite
listener supplies frontend modules, styles, and browser HMR. Edits replace
backend generations without restarting the public listener; streams from an
older generation drain before its exported `dispose()` runs.

Ctrl+C closes development. When the CLI starts another runtime, it forwards
termination signals and propagates the child process's exit status. Restart
after changing runtime selection, native listener options, or plugin code.

Without an explicit subcommand, `memoized-dom` starts development.

### Development inspector

Press **Alt+Shift+M** to toggle the docked inspector, or open `?mmd-inspect`.
The separate `@memoized-dom/devtools` package provides Live, Reactivity and Issues
views, an expanded workbench, self-hosted Geist fonts and light/dark themes.
No application import is required; UI assets load only when opened and are not
included in production builds. Disable the launcher with `devtools: false` in
the existing `memoizedDom(...)` options.

The native Bun/Node host also relays sanitized, instance-wide server observations
over the existing Vite development channel. Cloudflare and other SSR hosts
currently provide browser diagnostics only. Names and live keys can be sensitive;
keep the development server and exported reports private. See the
[inspector guide](../packages/devtools/README.md) for capture limits and privacy.

## `build`

```sh
memoized-dom build
```

Builds run under Node. The configured target determines the generated output,
not the executable used to invoke the CLI. Browser-only applications use Vite's
normal build. Fullstack applications build the client first, then the backend
with the SSR document, server functions, and asset delivery integrated.

Production startup remains host-specific: `bun dist/server.js` for Bun,
`node dist/server.js` for Node, and Cloudflare's deployment tooling for Workers.
The CLI provides `dev`, `build`, `types`, and `package`, not `start`, `preview`, or `deploy`.
Use `vite preview` for browser/Worker preview and `wrangler deploy` for Workers.

## `types`

```sh
memoized-dom types
memoized-dom types --config examples/fullstack/vite.config.ts
```

Generate `.memoized/server-functions.d.ts`, `server-config.d.ts`, and route
declarations from the configured source graph without a production build.
Declarations that are no longer needed are removed by the normal generators;
unchanged declarations retain their timestamps. This uses the configured Vite
resolution (including aliases and resolver plugins) and graph/declaration hooks.
It does not start a dev server, execute the application or its services, launch
the selected backend/Worker host, optimize dependencies, or emit bundles.
Configuration/graph failures exit nonzero instead of being hidden.

For a Bun application, keep type generation ahead of the type checker:

```json
{
  "scripts": {
    "typecheck": "memoized-dom types && bun check"
  }
}
```

Development and production builds still refresh these declarations automatically.
Use `types` for clean-clone/editor/CI setup when you do not need either server or
bundles. In this repository, run `bun install`, then `bun run build` once to build
the workspace packages. `bun run typecheck` then generates the fullstack example's
declarations before `bun check` and JSX coverage; an example production build is
not required. Run `types` with each project's config when checking another app.

## `package`

```ts
// .lib.config.ts
export default {
  entry: './src/index.ts',
  subpaths: ['./src/public'], // optional array of public directories
};
```

```sh
memoized-dom package
```

Build a reusable library through one configuration, without a Vite config,
manual artifact script or compiler fields in the source `package.json`. The CLI
discovers modules/public subpaths, compiles, bundles, emits declarations and
generates a finalized publishable package in `dist`. Publish that generated
directory, not the project root. The source manifest is never changed.

`--root` selects the package root; `--config` selects another library config.
No server/runtime host is started, and `--port` is not accepted for this command.
See [library packaging](./library-packaging.md) for output, options, declaration
requirements, public-path conflicts and current boundaries.

## Options

| Option | Meaning |
|---|---|
| `--config path` | Select another Vite configuration file, or a library config for `package`. |
| `--root path` | Set the application or library package root. |
| `--port number` | Set the development port; `0` requests an available port. |

The fullstack public port defaults to 3000. A backend's explicitly exported
native listener options can take precedence over the configured port.

For a repository containing several examples:

```sh
memoized-dom dev --config examples/fieldnotes/vite.config.ts
memoized-dom dev --config examples/fullstack/vite.cloudflare.config.ts
```

Only the selected configuration changes; the command shape stays the same.

## Working on the framework repository

From a fresh checkout, run:

```sh
bun install
bun run build
bun run typecheck
```

The repository's `types` and example scripts invoke `node packages/vite/dist/cli.js`
directly. During the first install that file has not been built yet, so the
package manager may not create a `memoized-dom` bin link. Direct invocation avoids
depending on that link; no second install is required after building. It still
uses the same CLI runtime selection. Installed application packages keep using
the normal `memoized-dom dev`, `build`, `types`, and `package` commands shown above.

## Browser cannot connect while the server is running

Check DevTools' Network dropdown. Chrome's **Offline** setting blocks requests
even when another browser works. Select **No throttling**, then retry navigation
or reload. Restarting the server does not change this browser setting.

## Recovering from editing errors

During development, invalid server-page edits show Vite's error overlay while
keeping the last working page visible. A corrected edit reloads the page with
fresh server output, including when you restore the exact original source.

If an uncaught backend/import error prevents a document from rendering, the
native Bun/Node development host returns a 500 development error page that
connects directly to Vite. Saving a correction reloads it automatically; it
does not depend on the broken backend serving the hot-reload client. This
recovery page is development-only and does not change function/API responses.
Restoring a temporarily missing server dependency also invalidates its affected
importers, so the repaired page does not retain a cached missing-module error.
The Bun development listener also allows slow compilation/render requests
without its default idle timeout; an explicit exported `idleTimeout` still wins.
