/** Render compiler-selected page definitions in isolated server sessions. */
import { registerRootFactory } from '@memoized-dom/runtime/server';
import { render } from './render';
import type { RenderOptions } from './index';
import type { ServerComponent } from './root-id';
import { encodePageHtml, type PageContent } from '@memoized-dom/runtime';
import { isServerPage, type ServerPageDefinition } from './page-definition';
import { encodePageInputs } from './page-inputs';
export { createServerPage, isServerPage } from './page-definition';
export type { ServerPageDefinition } from './page-definition';

export type ServerPageRender = PageContent;

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
