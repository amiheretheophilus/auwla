/**
 * The delivery module of a built server (`wiki/compiler/server.md`, "Delivery"): what gives the
 * server the page to render into (`document`) and the built client's files (`assets`), for the
 * runtime it runs on. The application's integration reads it (`application.ts`); the command line
 * writes one for each build (`project/cli.ts`).
 *
 * - `bun`: the files sit beside the server, in `./client/`, read from disk.
 * - `cloudflare`: a Worker has no disk. The files are uploaded as the Worker's static assets and
 *   reached through its assets binding (`env.ASSETS`), as `wrangler.json` declares (`workerConfig`).
 */

export type ServerRuntime = 'bun' | 'cloudflare';

export interface DeliveryOptions {
  readonly runtime: ServerRuntime;
  /** The built page, with `<!--ssr-outlet-->` where the app goes. */
  readonly document: string;
  /** The built client's files, relative to its folder. */
  readonly files: readonly string[];
  /** For `cloudflare`: the assets binding's name. Default `ASSETS`. */
  readonly assetsBinding?: string;
}

export function deliveryModule(options: DeliveryOptions): string {
  const page = JSON.stringify(options.document);
  const files = JSON.stringify(options.files);
  if (options.runtime === 'cloudflare') {
    const binding = JSON.stringify(options.assetsBinding ?? 'ASSETS');
    return `import { env } from 'cloudflare:workers';
import { createAssetHandler } from '@memoized-dom/adapters/cloudflare';
const page = ${page};
export default {
  document: () => page,
  assets: createAssetHandler(() => env[${binding}], { files: ${files} }),
};
`;
  }
  return `import { createAssetHandler } from '@memoized-dom/adapters/bun';
const page = ${page};
export default {
  document: () => page,
  assets: createAssetHandler(new URL('./client/', import.meta.url), { files: ${files} }),
};
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
