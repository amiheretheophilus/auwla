/**
 * Watching for the example previews. A preview stays running: when a file in its folder changes it
 * builds the app again, in about the time of one warm compile (the team example: ~120 ms against
 * ~1.3 s for a fresh process, `wiki/compiler/project.md`, "Start-up time"), then tells the open
 * pages to reload.
 *
 * The reload runs over a server-sent event stream. The preview adds a small inline script for it
 * to each HTML page it serves; `--build` output has none.
 */
import { watch } from 'node:fs';

/** The event stream the pages listen on. */
const RELOAD_PATH = '/__preview/reload';
const RELOAD_SCRIPT = `<script>new EventSource('${RELOAD_PATH}').onmessage = () => location.reload();</script>`;
/** Saves closer together than this make one build: an editor's save can write a file twice. */
const SETTLE_MS = 30;

/**
 * Calls `rebuild` with the files that changed in `folder` (paths relative to it): once per burst
 * of saves, and one build at a time. A change during a build starts one more build after it.
 * Folders whose name starts with a dot (`.memoized`, which a server preview writes) and
 * `node_modules` are not watched.
 */
export function watchFolder(folder: string, rebuild: (changed: readonly string[]) => Promise<void>): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let building = false;
  /** Changed since the last build started. */
  let changed = new Set<string>();

  const finished = (): void => {
    building = false;
    if (changed.size > 0) start();
  };
  const start = (): void => {
    if (building) return;
    building = true;
    const files = [...changed];
    changed = new Set();
    // A build that fails reports and keeps the last one; it never stops the watching.
    rebuild(files).then(finished, (error: unknown) => {
      console.error(error);
      finished();
    });
  };

  watch(folder, { recursive: true }, (_event, name) => {
    if (name === null || ignored(name)) return;
    changed.add(name.replaceAll('\\', '/'));
    clearTimeout(timer);
    timer = setTimeout(start, SETTLE_MS);
  });
}

function ignored(name: string): boolean {
  return name.split(/[\\/]/).some((segment) => segment.startsWith('.') || segment === 'node_modules');
}

/** The pages a preview has open, and the reload it sends them. */
export interface LiveReload {
  /** The reload stream, for its request; undefined for any other request. */
  answer(request: Request): Response | undefined;
  /** A served HTML response with the reload script added; any other response as it is. */
  withScript(response: Response): Promise<Response>;
  /** The page's HTML with the reload script added. */
  page(html: string): string;
  /** Tells every open page to reload. */
  reload(): void;
}

export function liveReload(): LiveReload {
  const open = new Set<ReadableStreamDefaultController<string>>();
  const page = (html: string): string => (html.includes('</body>') ? html.replace('</body>', `${RELOAD_SCRIPT}</body>`) : html + RELOAD_SCRIPT);

  return {
    answer(request) {
      if (new URL(request.url).pathname !== RELOAD_PATH) return undefined;
      const stream = new ReadableStream<string>({
        start(controller) {
          open.add(controller);
          // A closed tab ends the request: its stream takes no more events.
          request.signal.addEventListener('abort', () => open.delete(controller));
        },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    },
    async withScript(response) {
      if (!(response.headers.get('Content-Type') ?? '').startsWith('text/html')) return response;
      const headers = new Headers(response.headers);
      // The body grows by the script.
      headers.delete('Content-Length');
      return new Response(page(await response.text()), { status: response.status, statusText: response.statusText, headers });
    },
    page,
    reload() {
      for (const controller of open) controller.enqueue('data: reload\n\n');
    },
  };
}
