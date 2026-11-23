/**
 * What only Vite can do for a server rendered with the compiler: in development, the page comes
 * from Vite's dev server and the client's files from its transform pipeline; in a build, the
 * client folder is placed relative to each server chunk Vite emits. The production delivery and
 * host entry modules themselves are the compiler's (`server/delivery.ts`, `wiki/rules.md`, rule 17).
 */
import type { ViteDevServer } from 'vite';
import MagicString from 'magic-string';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { clientStyles } from './dev-assets';

export const integrationVirtualId = 'virtual:memoized-dom/integration';
export const resolvedIntegrationVirtualId = `\0${integrationVirtualId}`;
export const productionEntryVirtualId = 'virtual:memoized-dom/host-entry';
export const resolvedProductionEntryVirtualId = `\0${productionEntryVirtualId}`;
const documentEndpoint = '/__memoized/document';
/** Replaced, in each server chunk, by the client folder relative to that chunk (`relocateClientRoot`). */
export const clientRootPlaceholder = '__MEMOIZED_CLIENT_ROOT__';

export interface FullstackPluginApi {
  readonly serverEntry?: string;
  readonly runtime: 'bun' | 'node' | 'cloudflare';
  nativeDevelopment: boolean;
  /** Retire native server modules before a compiler-owned full reload. */
  invalidateBackend?: () => void;
  /**
   * The server program failed to build after an edit (an error), or builds again (undefined). The
   * native dev host answers new page loads with the error until then; requests from pages already
   * open keep reaching the last working backend.
   */
  serverBuildFailed?: (error: Error | undefined) => void;
  cloudflareAssetsBinding?: string;
  /** Build now and write the declarations the build made (`memoized-dom types`). */
  writeDeclarations?: () => Promise<void>;
}

/** Vite serves tooling only. The native backend never delegates application requests to Vite. */
export function configureDevelopmentDelivery(server: ViteDevServer): void {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== documentEndpoint) return next();
    try {
      let source: string;
      try { source = await readFile(resolve(server.config.root, 'index.html'), 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        response.setHeader('content-type', 'application/json');
        response.end('null');
        return;
      }
      const path = url.searchParams.get('path') ?? '/';
      let document = await server.transformIndexHtml(path, source);
      // Every page's stylesheets go in the document; a route's own go to the server, which links
      // them on a page of that route (`dev-assets.ts`).
      const styles = clientStyles(server);
      const links = styles.eager.filter(style => !document.includes(`href="${style}"`))
        .map(style => `<link rel="stylesheet" href="${style.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" data-memoized-dom-dev>`).join('');
      document = document.replace(/<\/head\s*>/i, close => links + close);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ document, routeStyles: styles.routes }));
    } catch (error) { next(error); }
  });
}

/**
 * The delivery a development server gives the running backend: the page from Vite's dev server
 * (`configureDevelopmentDelivery`), and the client's files through Vite, or on Cloudflare through
 * the Worker's assets binding. Server functions are the application's own (the compiler's wrapper).
 */
export function developmentIntegrationModule(server: ViteDevServer, runtime: FullstackPluginApi['runtime'] = 'bun', assetsBinding = 'ASSETS'): string {
  const address = server.httpServer?.address();
  if (runtime !== 'cloudflare' && (!address || typeof address === 'string')) {
    throw new Error('memoized-dom: start the native development launcher before loading the server entry');
  }
  const bound = typeof address === 'object' ? address : undefined;
  const host = !bound || bound.address === '::' || bound.address === '0.0.0.0' ? '127.0.0.1' : bound.address;
  const origin = `http://${host.includes(':') ? '[' + host + ']' : host}:${bound?.port}`;
  return `${runtime === 'cloudflare' ? "import { env } from 'cloudflare:workers';" : ''}
${runtime === 'cloudflare' ? '' : `const origin = ${JSON.stringify(origin)};`}
// The stylesheets each route brings, refreshed with each page's document, which the server reads
// after rendering that page (\`ServerIntegration.routeStyles\`).
const routeStyles = {};
export default {
  routeStyles,
  async document(request) {
    const url = new URL(${JSON.stringify(documentEndpoint)}, ${runtime === 'cloudflare' ? 'request.url' : 'origin'});
    const incoming = new URL(request.url);
    url.searchParams.set('path', incoming.pathname + incoming.search);
    const response = await fetch(url, { signal: request.signal });
    if (!response.ok) throw new Error('memoized-dom: development document preparation failed: ' + await response.text());
    const prepared = await response.json();
    if (prepared === null) return undefined;
    for (const key of Object.keys(routeStyles)) delete routeStyles[key];
    Object.assign(routeStyles, prepared.routeStyles);
    return prepared.document;
  },
  async assets(request) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method) || url.pathname.endsWith('.html') ||
        !(/\\.[^/]+$/.test(url.pathname) || /\\/(?:@vite|@id|@fs)\\//.test(url.pathname))) return;
    const headers = new Headers(request.headers);
    headers.delete('host');
    const response = await ${runtime === 'cloudflare' ? `env[${JSON.stringify(assetsBinding)}].fetch(request)` : `fetch(new URL(url.pathname + url.search, origin), {
      method: request.method, headers, signal: request.signal, redirect: 'manual'
    })`};
    if (response.status === 404) { await response.body?.cancel(); return; }
    return response;
  }
};`;
}

/** Asset roots stay relative to each emitted server chunk, so the output can be moved. */
export function relocateClientRoot(code: string, fileName: string, clientRoot = 'client') {
  if (!code.includes(clientRootPlaceholder)) return undefined;
  const root = (relative(dirname(fileName), clientRoot).replaceAll('\\', '/') || '.') + '/';
  const edited = new MagicString(code);
  for (const match of code.matchAll(new RegExp(clientRootPlaceholder, 'g'))) {
    edited.overwrite(match.index, match.index + clientRootPlaceholder.length, root);
  }
  return { code: edited.toString(), map: edited.generateMap({ source: fileName, hires: true }) };
}
