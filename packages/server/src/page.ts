/** Render compiler-selected page definitions in isolated server sessions. */
import { registerRootFactory } from '@memoized-dom/runtime/server';
import { render } from './render';
import type { RenderOptions } from './index';
import type { ServerComponent } from './root-id';
import { encodePageHtml, encodePageFrame, encodePageFailure, type PageContent } from '@memoized-dom/runtime';
import { isServerPage, pageUpdates, type ServerPageDefinition, type ServerPageUpdates } from './page-definition';
import { encodePageInputs } from './page-inputs';
import { RenderSession } from './session';
import { stringTier, type StringRenderableNode } from './string-document';
import { RegionTracker } from './stream-regions';
import { reportStreamError } from './live';
export { createServerPage, isServerPage } from './page-definition';
export type { ServerPageDefinition } from './page-definition';

export type ServerPageRender = PageContent;

/** Reuse the renderer's source settlement and region ownership, not a second async UI model. */
export function serverPageUpdates(page: ServerPageDefinition,
  options: Omit<RenderOptions, 'initialKey' | 'markers' | 'mode'> = {},
): ServerPageUpdates {
  const cancellation = new AbortController();
  options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, cancellation.signal]) : cancellation.signal };
  return pageUpdates(async function*() {
    // Existing fixed binding proofs have no unresolved render-time regions.
    // Keep their exact initial-HTML contract and interactive lifetime intact.
    if (page.binding) { yield await renderServerPage(page, options); return; }
    const component: ServerComponent = (id, parent) => page.create(id, parent);
    registerRootFactory(component, { id: page.id, create: () => component(page.id, null) });
    const session = new RenderSession(component, { ...options, mode: 'stream', markers: true }, stringTier());
    const generation = crypto.randomUUID();
    let sequence = 0;
    const changes = new Map<string, { id: string; html: string; sequence: number }>();
    try {
      await session.run(() => session.prepare());
      const root = session.run(() => session.mount()) as unknown as StringRenderableNode;
      const serialize = (node: StringRenderableNode) => node.toString(true, false);
      const tracker = new RegionTracker(root, serialize);
      const snapshot = (complete: boolean): PageContent => session.run(() => {
        sequence++;
        for (const region of tracker.changes()) changes.set(region.id, { ...region, sequence });
        let html = serialize(root);
        // One stable owner scopes marker lookup, even for authored fragments.
        if (page.wrapped) {
          if (!html.startsWith('<div>') || !html.endsWith('</div>')) throw new Error('memo-dom: invalid progressive page root');
          html = `<div style="display:contents" data-mmd-page-render="${generation}" data-mmd-page-sequence="${sequence}">` + html.slice(5);
        } else html = `<div style="display:contents" data-mmd-page-render="${generation}" data-mmd-page-sequence="${sequence}">` + html + '</div>';
        return { $mmd: 'page', version: 1, id: page.id, html,
          ...(page.styles?.length ? { styles: page.styles } : {}),
          progress: { id: generation, sequence, complete, regions: [...changes.values()].sort((a,b) => a.sequence - b.sequence) },
        };
      });
      const immediate = await session.run(() => session.dataRuntime.settle(0));
      yield snapshot(immediate);
      if (immediate) return;
      const budgetEnd = performance.now() + session.settleTimeout;
      for (;;) {
        const step = await session.run(() => session.nextSettlement(budgetEnd));
        if (step === 'timeout') throw new DOMException('Server page did not settle before its timeout', 'TimeoutError');
        yield snapshot(step === 'idle');
        if (step === 'idle') return;
      }
    } finally { session.dispose(); }
  }, () => cancellation.abort());
}

/** Negotiate inert, incrementally decoded HTML without changing ordinary endpoint reads. */
export async function serverPageStreamResponse(updates: ServerPageUpdates, request: Request,
  onError?: (error: unknown) => void | Promise<void>,
): Promise<Response> {
  const iterator = updates[Symbol.asyncIterator]();
  // First-mount failures still belong to ordinary HTTP/onError handling.
  let first: IteratorResult<PageContent> | undefined = await iterator.next();
  const encoder = new TextEncoder();
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; updates.cancel(); await iterator.return?.().catch(() => {}); } };
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stopped) { controller.close(); return; }
      try {
        const current = first ?? await iterator.next(); first = undefined;
        if (current.done) { controller.close(); await stop(); return; }
        controller.enqueue(encoder.encode(encodePageFrame(current.value)));
      } catch (error) {
        const failed = !stopped && !request.signal.aborted;
        try { if (failed) controller.enqueue(encoder.encode(encodePageFailure())); if (!stopped) controller.close(); }
        finally { await stop(); if (failed) void reportStreamError(error, request, onError); }
      }
    },
    cancel: stop,
  }, { highWaterMark: 1 }), { headers: {
    'content-type': 'text/html; charset=utf-8', 'x-mmd-page': '2',
    'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff',
  } });
}

/** Finite UI results are HTML fragments, never document navigation instructions. */
export function serverPageResponse(page: PageContent): Response {
  return new Response(encodePageHtml(page), { headers: {
    'content-type': 'text/html; charset=utf-8',
    'x-mmd-page': '1',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  } });
}

/**
 * Evaluate a selected page without rerunning its action. Vite supplies the
 * matching binding identity and projected client inputs; opaque definitions
 * never pass through ordinary data serialization before this boundary.
 */
export async function renderServerPage(
  page: ServerPageDefinition,
  options: Omit<RenderOptions, 'initialKey' | 'markers' | 'mode'> = {},
): Promise<ServerPageRender> {
  if (!isServerPage(page)) throw new TypeError('Expected a compiled server page');
  const component: ServerComponent = (id, parent) => page.create(id, parent);
  registerRootFactory(component, { id: page.id, create: () => component(page.id, null),
    ...(page.delivery ? {initialDelivery:page.delivery} : {}),
  });
  const result = await render(component, { ...options, mode: 'resolve', markers: false,
    ...(page.delivery ? {initialKey:page.delivery.key} : {}),
  });
  if (result.settlement.status === 'timeout') {
    throw new DOMException('Server page did not settle before its timeout', 'TimeoutError');
  }
  let html = result.html;
  if (page.wrapped) {
    if (!html.startsWith('<div>') || !html.endsWith('</div>')) throw new Error('memo-dom: invalid compiled page root');
    html = page.binding ? '<div style="display:contents">' + html.slice(5) : html.slice(5, -6);
  }
  return { $mmd: 'page', version: 1, id: page.id, html,
    ...(page.styles?.length ? {styles:page.styles} : {}),
    ...(page.binding ? { binding: { key: page.binding.key, ...encodePageInputs(page.binding.inputs()) } } : {}),
  };
}
