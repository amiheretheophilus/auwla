/**
 * What the router and its server-function routes share: how a handler's value becomes a
 * response, how a server page a function returns is rendered, where a request's stream errors are
 * reported, and the brand that marks a route as a server function's.
 */
import { isServerPage } from './page-definition';
import type { ServerContext, ServerRoute } from './http-router';

/**
 * String-keyed brand: route objects cross module instances (dev-server vs
 * host), where a Symbol identity would not match.
 */
export const SERVER_FUNCTION_ROUTE_KEY = '__memoDomServerFunctionRoute';

export type InternalServerFunctionRoute<TLocals extends object, TPlatform, TServices extends object> =
  ServerRoute<TLocals, TPlatform, TServices> & {
    readonly [SERVER_FUNCTION_ROUTE_KEY]?: true;
    readonly __memoizedLive?: boolean;
  };

const pageFetches = new WeakMap<object, typeof globalThis.fetch>();

/** @internal Same request dispatch capability already used by document SSR. */
export function installServerPageFetch(context: object, fetch: typeof globalThis.fetch): void {
  pageFetches.set(context, fetch);
}

// Keep reporting request-scoped without adding public context fields or retaining
// completed requests. Live bodies execute after the dispatch try/catch returns.
export const streamErrorReporters = new WeakMap<object, (error: unknown) => Promise<void>>();

/** A server page a function returned, rendered (or streamed) for this request; any other value as is. */
export async function serverFunctionValue(
  value: unknown,
  context: ServerContext<object, unknown, object>,
  fetchContext: object = context,
  html = false,
): Promise<unknown> {
  if (!isServerPage(value)) return value;
  const { renderServerPage, serverPageResponse, serverPageUpdates, serverPageStreamResponse } = await import('./page');
  const options = {
    url: context.url.href, signal: context.request.signal, routedContext: context,
    ...(pageFetches.has(fetchContext) ? { fetch: pageFetches.get(fetchContext)! } : {}),
  };
  if (context.request.headers.get('x-mmd-page-stream') === '1' && context.request.headers.get('x-mmd-stream') !== 'snapshot') {
    const updates = serverPageUpdates(value, options);
    return html ? serverPageStreamResponse(updates, context.request, streamErrorReporters.get(fetchContext)) : updates;
  }
  const rendered = await renderServerPage(value, options);
  return html ? serverPageResponse(rendered) : rendered;
}

/** A consistency retry owns its discarded body/iterator, not the eventual caller. */
export async function discardServerFunctionValue(value: unknown): Promise<void> {
  if (value instanceof Response) await value.body?.cancel();
  else if (value !== null && typeof value === 'object' && Symbol.asyncIterator in value) {
    const iterator = (value as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    await iterator.return?.();
  }
}

function textResponse(value: string): Response {
  return new Response(value, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/** A handler's value as a response: nothing is a 204, a string is text, anything else JSON. */
export function normalizeHandlerResult(value: unknown): Response {
  if (value instanceof Response) return value;
  if (value === undefined) return new Response(null, { status: 204 });
  if (typeof value === 'string') return textResponse(value);
  if (value instanceof ReadableStream) return new Response(value);
  return Response.json(value);
}

/**
 * Without `onError`, the client still gets a private 500, but the failure is
 * never silent on the server: a page that renders empty must say why.
 */
export function reportUnhandledError(request: Request, error: unknown): void {
  // A request its caller cancelled (a navigation, a finished page render)
  // did not fail.
  if (request.signal.aborted || (error as { name?: unknown } | null)?.name === 'AbortError') return;
  const url = new URL(request.url);
  console.error(`[memoized-dom] ${request.method} ${url.pathname} failed:`, error);
}
