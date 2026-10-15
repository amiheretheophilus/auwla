/** Internal server-owned page foundation. Browser delivery is a separate layer. */
import { registerRootFactory } from '@memoized-dom/runtime/server';
import { render, type RenderOptions } from './index';
import type { ServerComponent } from './root-id';

const PAGE = Symbol('memoized-dom:server-page');

export interface ServerPageDefinition {
  readonly [PAGE]: true;
  readonly id: string;
  readonly create: ServerComponent;
}

export interface ServerPageRender {
  readonly id: string;
  readonly html: string;
}

/** Compiler-owned constructor: never evaluate JSX before render isolation exists. */
export function createServerPage(
  id: string,
  factory: (id: string, parent: null, captures: readonly unknown[]) => Node,
  captures: readonly unknown[] = [],
): ServerPageDefinition {
  if (typeof id !== 'string' || !id || typeof factory !== 'function' || !Array.isArray(captures)) throw new TypeError('Invalid compiled server page');
  const inputs = Object.freeze([...captures]);
  const create: ServerComponent = (root, parent) => factory(root, parent, inputs);
  return Object.freeze({ [PAGE]: true as const, id, create,
    toJSON(): never {
      throw new TypeError('A server page requires renderable-result delivery; it cannot be serialized as ordinary data');
    },
  });
}

export function isServerPage(value: unknown): value is ServerPageDefinition {
  return typeof value === 'object' && value !== null && PAGE in value;
}

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
  return { id: page.id, html: result.html };
}
