import { parseSync, type ViteDevServer } from 'vite';
import MagicString from 'magic-string';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { clientStyleUrls } from './dev-assets';
import { serverFunctionsVirtualId } from './server-functions';

export const applicationVirtualId = 'virtual:memoized-dom/application';
export const integrationVirtualId = 'virtual:memoized-dom/integration';
export const resolvedApplicationVirtualId = `\0${applicationVirtualId}`;
export const resolvedIntegrationVirtualId = `\0${integrationVirtualId}`;
export const productionEntryVirtualId = 'virtual:memoized-dom/host-entry';
export const resolvedProductionEntryVirtualId = `\0${productionEntryVirtualId}`;
const documentEndpoint = '/__memoized/document';
const clientRootPlaceholder = '__MEMOIZED_CLIENT_ROOT__';

export interface FullstackPluginApi {
  readonly serverEntry?: string;
  readonly runtime: 'bun' | 'node' | 'cloudflare';
  nativeDevelopment: boolean;
  /** Retire native server modules before a compiler-owned full reload. */
  invalidateBackend?: () => void;
  cloudflareAssetsBinding?: string;
}

export interface ProductionDelivery {
  readonly document: string;
  readonly files: readonly string[];
  readonly base: string;
  readonly assetsDir: string;
  readonly clientRoot: string;
  readonly runtime: 'bun' | 'node' | 'cloudflare';
  readonly assetsBinding?: string;
}

/** Bind serve() at its import site, so nesting it inside Hono needs no discovery or globals. */
export function integratedServerImports(code: string, id: string) {
  if (!code.includes('@memoized-dom/server')) return undefined;
  const parsed = parseSync(id, code);
  const edits: { start: number; end: number }[] = [];
  for (const statement of parsed.program.body) {
    if ((statement.type === 'ImportDeclaration' || statement.type === 'ExportNamedDeclaration' ||
      statement.type === 'ExportAllDeclaration') && statement.source?.value === '@memoized-dom/server') {
      if (statement.type === 'ImportDeclaration' && !statement.specifiers.some(specifier =>
        specifier.type === 'ImportNamespaceSpecifier' ||
        (specifier.type === 'ImportSpecifier' && (specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value) === 'serve'))) continue;
      edits.push(statement.source);
    }
  }
  if (edits.length === 0) return undefined;
  const edited = new MagicString(code);
  for (const edit of edits) {
    edited.overwrite(edit.start, edit.end, JSON.stringify(applicationVirtualId));
  }
  return { code: edited.toString(), map: edited.generateMap({ source: id, includeContent: true, hires: true }) };
}

export function applicationModule(runtime: FullstackPluginApi['runtime'] = 'bun'): string {
  return `export * from '@memoized-dom/server';
import { serve as createApplication, integrateApplication } from '@memoized-dom/server';
import integration from ${JSON.stringify(integrationVirtualId)};
export function serve(options) {
  const application = integrateApplication(createApplication(options), integration);
  ${runtime === 'cloudflare' ? `const dispatch = application.fetch;
  application.fetch = (request, options, executionCtx) => dispatch(request,
    executionCtx === undefined ? options : { platform: { env: options, executionCtx } });` : ''}
  return application;
}`;
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
      const styles = await clientStyleUrls(server, path);
      const links = styles.filter(style => !document.includes(`href="${style}"`))
        .map(style => `<link rel="stylesheet" href="${style.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" data-memoized-dom-dev>`).join('');
      document = document.replace(/<\/head\s*>/i, close => links + close);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(document));
    } catch (error) { next(error); }
  });
}

export function developmentIntegrationModule(server: ViteDevServer, runtime: FullstackPluginApi['runtime'] = 'bun', assetsBinding = 'ASSETS'): string {
  const address = server.httpServer?.address();
  if (runtime !== 'cloudflare' && (!address || typeof address === 'string')) {
    throw new Error('memoized-dom: start the native development launcher before loading the server entry');
  }
  const bound = typeof address === 'object' ? address : undefined;
  const host = !bound || bound.address === '::' || bound.address === '0.0.0.0' ? '127.0.0.1' : bound.address;
  const origin = `http://${host.includes(':') ? '[' + host + ']' : host}:${bound?.port}`;
  return `${runtime === 'cloudflare' ? "import { env } from 'cloudflare:workers';" : ''}
import { serverFunctionRoutes } from ${JSON.stringify(serverFunctionsVirtualId)};
${runtime === 'cloudflare' ? '' : `const origin = ${JSON.stringify(origin)};`}
export default {
  get routes() { return serverFunctionRoutes; },
  async document(request) {
    const url = new URL(${JSON.stringify(documentEndpoint)}, ${runtime === 'cloudflare' ? 'request.url' : 'origin'});
    const incoming = new URL(request.url);
    url.searchParams.set('path', incoming.pathname + incoming.search);
    const response = await fetch(url, { signal: request.signal });
    if (!response.ok) throw new Error('memoized-dom: development document preparation failed: ' + await response.text());
    return await response.json() ?? undefined;
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

export function productionIntegrationModule(delivery: ProductionDelivery): string {
  if (delivery.runtime === 'cloudflare') {
    return `import { serverFunctionRoutes } from ${JSON.stringify(serverFunctionsVirtualId)};
import { env } from 'cloudflare:workers';
import { createAssetHandler } from '@memoized-dom/adapters/cloudflare';
export default {
  get routes() { return serverFunctionRoutes; },
  document: () => ${JSON.stringify(delivery.document)},
  assets: createAssetHandler(() => env[${JSON.stringify(delivery.assetsBinding ?? 'ASSETS')}], {
    files: ${JSON.stringify(delivery.files)}, base: ${JSON.stringify(delivery.base)}, assetsDir: ${JSON.stringify(delivery.assetsDir)}
  })
};`;
  }
  return `import { serverFunctionRoutes } from ${JSON.stringify(serverFunctionsVirtualId)};
import { createAssetHandler } from ${JSON.stringify(`@memoized-dom/adapters/${delivery.runtime}`)};
export default {
  get routes() { return serverFunctionRoutes; },
  document: () => ${JSON.stringify(delivery.document)},
  assets: createAssetHandler(new URL(${JSON.stringify(clientRootPlaceholder)}, import.meta.url), {
    files: ${JSON.stringify(delivery.files)}, base: ${JSON.stringify(delivery.base)}, assetsDir: ${JSON.stringify(delivery.assetsDir)}
  })
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

/** Node's executable entry starts a listener; importing it still gives the backend. */
export function nodeProductionEntry(entry: string): string {
  const source = JSON.stringify(entry);
  return `import backend from ${source};
export * from ${source};
export default backend;
import { createServer } from 'node:http';
import { toWebRequest, sendNodeResponse } from '@memoized-dom/adapters/node';
if (import.meta.main) {
  const listener = createServer(async (incoming, outgoing) => {
    try {
      const platform = { incoming, outgoing };
      const response = await backend.fetch(toWebRequest(incoming), backend.installIntegration ? { platform } : platform);
      await sendNodeResponse(response ?? new Response('Not Found', { status: 404 }), outgoing);
    } catch (error) {
      console.error(error);
      if (outgoing.headersSent) outgoing.destroy(error instanceof Error ? error : undefined);
      else { outgoing.statusCode = 500; outgoing.end('Internal Server Error'); }
    }
  });
  const hostname = backend.hostname ?? '127.0.0.1';
  listener.listen(Number(backend.port ?? process.env.PORT ?? 3000), hostname, () => {
    console.log('Memoized DOM (node): http://' + hostname + ':' + listener.address().port);
  });
}
`;
}

/** Normalize the host argument for both direct serve() exports and other backends. */
export function bunProductionEntry(entry: string): string {
  const source = JSON.stringify(entry);
  return `import backend from ${source};
export * from ${source};
const host = {};
for (const key of ['port', 'hostname', 'websocket', 'error', 'idleTimeout', 'maxRequestBodySize', 'tls', 'reusePort', 'ipv6Only']) {
  if (backend[key] !== undefined) host[key] = backend[key];
}
host.fetch = (request, platform) => backend.fetch(request, backend.installIntegration ? { platform } : platform);
export default host;`;
}
