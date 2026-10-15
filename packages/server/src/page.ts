/** Internal server-owned page foundation. Browser delivery is a separate layer. */
import { registerRootFactory } from '@memoized-dom/runtime/server';
import { render, type RenderOptions } from './index';
import type { ServerComponent } from './root-id';
import type { PageContent } from '@memoized-dom/runtime';
import { isServerPage, type ServerPageDefinition } from './page-definition';
export { createServerPage, isServerPage } from './page-definition';
export type { ServerPageDefinition } from './page-definition';

export type ServerPageRender = PageContent;

/**
 * Evaluate a selected page in the existing isolated renderer. This intentionally
 * returns an internal render product, not a browser-ready response: interaction
 * bindings must be linked before the result may be delivered to an application.
 */
export async function renderServerPage(
  page: ServerPageDefinition,
  options: Omit<RenderOptions, 'initialKey' | 'markers' | 'mode'> = {},
): Promise<ServerPageRender> {
  if (!isServerPage(page)) throw new TypeError('Expected a compiled server page');
  const component: ServerComponent = (id, parent) => page.create(id, parent);
  registerRootFactory(component, { id: page.id, create: () => component(page.id, null) });
  const result = await render(component, { ...options, mode: 'resolve', markers: false });
  if (result.settlement.status === 'timeout') {
    throw new DOMException('Server page did not settle before its timeout', 'TimeoutError');
  }
  let html = result.html;
  if (page.wrapped) {
    if (!html.startsWith('<div>') || !html.endsWith('</div>')) throw new Error('memo-dom: invalid compiled page root');
    html = page.binding ? '<div style="display:contents">' + html.slice(5) : html.slice(5, -6);
  }
  return { $mmd: 'page', version: 1, id: page.id, html,
    ...(page.binding ? { binding: { key: page.binding.key, inputs: page.binding.inputs() } } : {}),
  };
}
