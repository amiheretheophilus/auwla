import type { PageContent } from '@memoized-dom/runtime';
import type { ServerComponent } from './root-id';

const PAGE = Symbol('memoized-dom:server-page');

export interface ServerPageDefinition {
  readonly [PAGE]: true;
  readonly id: string;
  readonly create: ServerComponent;
  readonly binding?: { readonly key: string; readonly inputs: () => readonly unknown[] };
  readonly wrapped?: boolean;
}

/** Authoring boundary; the compiler replaces the call before JSX is evaluated. */
export function page(_content: Node): PageContent {
  throw new Error('memo-dom: page(JSX) requires the Memoized DOM server-function compiler');
}

export function createServerPage(
  id: string,
  factory: (id: string, parent: null, captures: readonly unknown[]) => Node,
  captures: readonly unknown[] = [],
  binding?: ServerPageDefinition['binding'],
  wrapped = false,
): ServerPageDefinition {
  if (typeof id !== 'string' || !id || typeof factory !== 'function' || !Array.isArray(captures)) throw new TypeError('Invalid compiled server page');
  const inputs = Object.freeze([...captures]);
  const create: ServerComponent = (root, parent) => factory(root, parent, inputs);
  return Object.freeze({ [PAGE]: true as const, id, create, binding, wrapped,
    toJSON(): never { throw new TypeError('A server page requires renderable-result delivery; it cannot be serialized as ordinary data'); },
  });
}

export function isServerPage(value: unknown): value is ServerPageDefinition {
  return typeof value === 'object' && value !== null && PAGE in value;
}
