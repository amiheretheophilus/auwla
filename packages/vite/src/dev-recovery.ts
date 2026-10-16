import type { ViteDevServer } from 'vite';

export const serverUpdateEvent = 'memoized-dom:server-update';

export function isDocumentRequest(request: Request): boolean {
  const destination = request.headers.get('sec-fetch-dest');
  return (request.method === 'GET' || request.method === 'HEAD') &&
    (destination === 'document' || destination === 'iframe' ||
      (destination === null && request.headers.get('accept')?.includes('text/html') === true));
}

/** Keep development errors connected even when importing the backend fails. */
export function recoveryDocument(vite: ViteDevServer, toolingOrigin: string, error: unknown): Response {
  const detail = error instanceof Error ? error : new Error(String(error));
  vite.config.logger.error(detail.stack ?? detail.message);
  const payload = JSON.stringify({ message: detail.message, stack: detail.stack })
    .replaceAll('<', '\\u003c');
  const client = JSON.stringify(new URL(vite.config.base + '@vite/client', toolingOrigin).href);
  // Import directly from the tooling host: the failing backend cannot be relied
  // on to proxy /@vite/client (or any of its dependencies).
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Development error</title></head>
<body><h1>Development error</h1><p>Correct the code to reload this page automatically.</p>
<script type="module">
import { createHotContext, ErrorOverlay } from ${client};
const hot = createHotContext('/__memoized/recovery');
hot.on('vite:afterUpdate', () => location.reload());
hot.on(${JSON.stringify(serverUpdateEvent)}, () => location.reload());
document.body.appendChild(new ErrorOverlay(${payload}));
</script></body></html>`;
  return new Response(html, { status: 500, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
  } });
}
