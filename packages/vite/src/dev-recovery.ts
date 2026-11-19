import type { ViteDevServer } from 'vite';

export const serverUpdateEvent = 'memoized-dom:server-update';

export function isDocumentRequest(request: Request): boolean {
  const destination = request.headers.get('sec-fetch-dest');
  return (request.method === 'GET' || request.method === 'HEAD') &&
    (destination === 'document' || destination === 'iframe' ||
      (destination === null && request.headers.get('accept')?.includes('text/html') === true));
}

/** What Vite's error overlay shows. */
interface OverlayError {
  readonly message: string;
  readonly stack: string;
  readonly id?: string;
  readonly frame?: string;
  readonly plugin?: string;
  readonly loc?: { readonly file: string; readonly line: number; readonly column: number };
}

/**
 * An error loading the backend, as the terminal and the overlay show it. A compile error arrives
 * from Vite's module runner with the file, place and code frame the plugin gave it, and a stack
 * through the runner's own code. The mistake is in the author's file, so it is shown with that
 * frame and without the runner's stack.
 */
export function developmentError(error: unknown): { readonly text: string; readonly overlay: OverlayError } {
  const detail = error instanceof Error ? error : new Error(String(error));
  const fields = detail as Error & Partial<Omit<OverlayError, 'message' | 'stack'>>;
  if (typeof fields.frame !== 'string') {
    const stack = detail.stack ?? detail.message;
    return { text: stack, overlay: { message: detail.message, stack } };
  }
  const overlay: OverlayError = {
    message: detail.message, stack: '', frame: fields.frame,
    ...(typeof fields.id === 'string' ? { id: fields.id } : {}),
    ...(typeof fields.plugin === 'string' ? { plugin: fields.plugin } : {}),
    ...(fields.loc === undefined ? {} : { loc: fields.loc }),
  };
  return { text: `${detail.message}\n${fields.frame}`, overlay };
}

/** Keep development errors connected even when importing the backend fails. */
export function recoveryDocument(vite: ViteDevServer, toolingOrigin: string, error: unknown): Response {
  const { text, overlay } = developmentError(error);
  vite.config.logger.error(text);
  const payload = JSON.stringify(overlay)
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
