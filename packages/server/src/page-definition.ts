import { createPropsCell, valueComponent, type PageContent } from '@memoized-dom/runtime';
import type { ServerComponent } from './root-id';
import { projectPageInputs } from './page-inputs';

const PAGE = /* @__PURE__ */ Symbol('memoized-dom:server-page');
const PROGRESSIVE_PAGE = Symbol('memoized-dom:page-render');
/** Internal renderer iteration, never an authored generator function. */
export interface ServerPageUpdates extends AsyncIterable<PageContent> { readonly [PROGRESSIVE_PAGE]: true; cancel(): void }
export function pageUpdates(iterate: () => AsyncGenerator<PageContent>, cancel: () => void): ServerPageUpdates {
  return { [PROGRESSIVE_PAGE]: true, [Symbol.asyncIterator]: iterate, cancel };
}
export function isServerPageUpdates(value: unknown): value is ServerPageUpdates {
  return typeof value === 'object' && value !== null && PROGRESSIVE_PAGE in value;
}

export interface ServerPageDefinition {
  readonly [PAGE]: true;
  readonly id: string;
  readonly create: ServerComponent;
  readonly binding?: { readonly key: string; readonly inputs: () => readonly unknown[] };
  readonly wrapped?: boolean;
  /** the compiler's page: its HTML, when it has bindings, goes inside one root element. */
  readonly contained?: true;
  readonly styles?: readonly string[];
  readonly delivery?: {readonly key:string; readonly browser:'none'|'bindings'; readonly target:string};
}

/** Authoring boundary; the compiler replaces the call before JSX is evaluated. */
export function page(_content: Node): PageContent {
  throw new Error('memo-dom: page(JSX) requires the Memoized DOM server-function compiler');
}

export function createServerPage(
  id: string,
  factory: (id: string, parent: null, captures: readonly unknown[]) => Node,
  captures: readonly unknown[] = [],
  contract?: {readonly key:string; readonly paths:readonly (readonly (string|number)[])[]; readonly browser:'none'|'bindings'; readonly styles?:readonly string[]} | null,
  wrapped = false,
): ServerPageDefinition {
  if (typeof id !== 'string' || !id || typeof factory !== 'function' || !Array.isArray(captures)) throw new TypeError('Invalid compiled server page');
  const inputs = Object.freeze([...captures]);
  const create: ServerComponent = (root, parent) => factory(root, parent, inputs);
  const binding = contract?.browser === 'bindings' ? {key:contract.key, inputs:()=>projectPageInputs(inputs,contract.paths)} : undefined;
  return Object.freeze({ [PAGE]: true as const, id, create, binding, wrapped,
    ...(contract?.styles?.length ? {styles:contract.styles} : {}),
    ...(contract ? {delivery:{key:contract.key,browser:contract.browser,target:'__mmd_page_root'}} : {}),
    toJSON(): never { throw new TypeError('A server page requires renderable-result delivery; it cannot be serialized as ordinary data'); },
  });
}

/**
 * The compiler's page (`packages/compiler/src/server/pages.ts`): `component` is the page
 * module's compiled `Page<n>(inputs)`, which takes a props cell rather than the old compiler's
 * props array. The browser renders the same component into the page's root element, so a page
 * with bindings is rendered inside one `display: contents` element (`renderServerPage`).
 */
export function createComponentPage(
  id: string,
  component: Function,
  captures: readonly unknown[] = [],
  contract?: {readonly key:string; readonly paths:readonly (readonly (string|number)[])[]; readonly browser:'none'|'bindings'; readonly styles?:readonly string[]} | null,
): ServerPageDefinition {
  const compiled = valueComponent(component) as (id: string, parent: string | null, props: unknown) => Node;
  const factory = (root: string, parent: null, inputs: readonly unknown[]) => compiled(root, parent, createPropsCell(inputs, [inputs]));
  return Object.freeze({ ...createServerPage(id, factory, captures, contract, false), contained: true as const,
    toJSON(): never { throw new TypeError('A server page requires renderable-result delivery; it cannot be serialized as ordinary data'); },
  });
}

export function isServerPage(value: unknown): value is ServerPageDefinition {
  return typeof value === 'object' && value !== null && PAGE in value;
}
