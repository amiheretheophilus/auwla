/**
 * The delivery module of a built server (`wiki/compiler/server.md`, "Delivery"): what gives the
 * server the page to render into (`document`) and the built client's files (`assets`), for the
 * runtime it runs on. The application's integration reads it (`application.ts`); the command line
 * writes one for each build (`project/cli.ts`).
 *
 * - `bun` and `node`: the files sit beside the server, in `./client/` (or `clientRoot`), read from
 *   disk.
 * - `cloudflare`: a Worker has no disk. The files are uploaded as the Worker's static assets and
 *   reached through its assets binding (`env.ASSETS`), as `wrangler.json` declares (`workerConfig`).
 *
 * The CLI and the Vite plugin both write theirs with it (`wiki/rules.md`, rule 17).
 */

export type ServerRuntime = 'bun' | 'node' | 'cloudflare';

export interface DeliveryOptions {
  readonly runtime: ServerRuntime;
  /** The built page, with `<!--ssr-outlet-->` where the app goes. */
  readonly document: string;
  /** The built client's files, relative to its folder. */
  readonly files: readonly string[];
  /** For `cloudflare`: the assets binding's name. Default `ASSETS`. */
  readonly assetsBinding?: string;
  /** The path the client is served below (a bundler's `base`, `/app/`). Default `/`. */
  readonly base?: string;
  /** The client folder's hashed-assets folder (`assets`), which is served with long caching. */
  readonly assetsDir?: string;
  /**
   * For `bun` and `node`: the client folder, relative to the module that imports this one.
   * Default `./client/`. A bundler that only knows where each chunk lands after it renders passes a
   * placeholder and replaces it then.
   */
  readonly clientRoot?: string;
  /** The stylesheets each lazily loaded route component's chunk brings, by its key (`ServerIntegration.routeStyles`). */
  readonly routeStyles?: Readonly<Record<string, readonly string[]>>;
}

export function deliveryModule(options: DeliveryOptions): string {
  const page = JSON.stringify(options.document);
  const assetOptions = JSON.stringify({
    files: options.files,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.assetsDir === undefined ? {} : { assetsDir: options.assetsDir }),
  });
  // The page links the styles of the lazily loaded routes it renders (`route-styles.ts`).
  const routeStyles = options.routeStyles === undefined ? '' : `\n  routeStyles: ${JSON.stringify(options.routeStyles)},`;
  if (options.runtime === 'cloudflare') {
    const binding = JSON.stringify(options.assetsBinding ?? 'ASSETS');
    return `import { env } from 'cloudflare:workers';
import { createAssetHandler } from '@memoized-dom/adapters/cloudflare';
const page = ${page};
export default {
  document: () => page,
  assets: createAssetHandler(() => env[${binding}], ${assetOptions}),${routeStyles}
};
`;
  }
  const root = JSON.stringify(options.clientRoot ?? './client/');
  return `import { createAssetHandler } from '@memoized-dom/adapters/${options.runtime}';
const page = ${page};
export default {
  document: () => page,
  assets: createAssetHandler(new URL(${root}, import.meta.url), ${assetOptions}),${routeStyles}
};
`;
}

/**
 * The module a built server starts from on `bun` or `node`, around the app's server entry
 * (`./server.ts`), which it re-exports.
 *
 * - `bun` runs a default export with `fetch` as a server. The entry's own options (`port`,
 *   `hostname`, `tls`, …) are kept, and a request's platform reaches an application made with
 *   `serve()` as `{ platform }`, any other backend as it comes.
 * - `node` has no such convention, so run directly (`node dist/server.js`) the module listens
 *   itself; imported, it only gives the backend. A failed request answers 500, through the
 *   promise's rejection handler (`wiki/rules.md`, rule 5: generated code has no `try`).
 */
export function hostEntryModule(runtime: 'bun' | 'node', entry: string): string {
  const source = JSON.stringify(entry);
  if (runtime === 'bun') {
    return `import backend from ${source};
export * from ${source};
const host = {};
for (const key of ['port', 'hostname', 'websocket', 'error', 'idleTimeout', 'maxRequestBodySize', 'tls', 'reusePort', 'ipv6Only']) {
  if (backend[key] !== undefined) host[key] = backend[key];
}
host.fetch = (request, platform) => backend.fetch(request, backend.installIntegration ? { platform } : platform);
export default host;
`;
  }
  return `import backend from ${source};
export * from ${source};
export default backend;
import { createServer } from 'node:http';
import { toWebRequest, sendNodeResponse } from '@memoized-dom/adapters/node';
if (import.meta.main) {
  const listener = createServer((incoming, outgoing) => {
    const platform = { incoming, outgoing };
    Promise.resolve()
      .then(() => backend.fetch(toWebRequest(incoming), backend.installIntegration ? { platform } : platform))
      .then((response) => sendNodeResponse(response ?? new Response('Not Found', { status: 404 }), outgoing))
      .then(undefined, (error) => {
        console.error(error);
        if (outgoing.headersSent) {
          outgoing.destroy(error instanceof Error ? error : undefined);
          return;
        }
        outgoing.statusCode = 500;
        outgoing.end('Internal Server Error');
      });
  });
  const hostname = backend.hostname ?? '127.0.0.1';
  listener.listen(Number(backend.port ?? process.env.PORT ?? 3000), hostname, () => {
    console.log('Memoized DOM (node): http://' + hostname + ':' + listener.address().port);
  });
}
`;
}

/**
 * The delivery of a server built on its own, with no client build beside it and no development
 * server (`vite build --ssr server.ts`): it gives no page and no files, so the application renders
 * into the template it is given (`installDocumentTemplate`) and serves no assets.
 */
export function standaloneDeliveryModule(): string {
  return `export default {
  document: () => undefined,
  assets: () => undefined,
};
`;
}

export interface WorkerConfigOptions {
  /** The Worker's name. */
  readonly name: string;
  /** The Worker's script, relative to the config. */
  readonly main: string;
  /** The built client's folder, relative to the config. */
  readonly assets: string;
  readonly assetsBinding?: string;
  /** Workers' compatibility date. Default `COMPATIBILITY_DATE`. */
  readonly compatibilityDate?: string;
}

/**
 * The Workers behaviour the framework is tested with (`project/cli.test.ts`, in workerd). Workers
 * treat the date as a contract, so it moves with the framework, not with the clock: the day of the
 * build can be newer than a local workerd supports, which then refuses to start.
 */
export const COMPATIBILITY_DATE = '2026-10-01';

/**
 * `wrangler.json` for a built Worker: `wrangler deploy --config dist/wrangler.json`. The Worker runs
 * first for every request, so it renders pages and answers server functions; the assets binding
 * then serves the client's files when the Worker asks for one. Request context needs Node
 * compatibility (`AsyncLocalStorage`).
 */
export function workerConfig(options: WorkerConfigOptions): Record<string, unknown> {
  return {
    name: options.name,
    main: options.main,
    compatibility_date: options.compatibilityDate ?? COMPATIBILITY_DATE,
    compatibility_flags: ['nodejs_compat'],
    assets: {
      directory: options.assets,
      binding: options.assetsBinding ?? 'ASSETS',
      run_worker_first: true,
      html_handling: 'none',
      not_found_handling: 'none',
    },
  };
}
