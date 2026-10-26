/**
 * markup.ts - "DOM as data" materialization for compiler-generated static
 * subtrees.
 *
 * The compiler serializes each eligible static subtree into a module-level
 * markup string and emits one materializeMarkup(markup) call per segment.
 * The call returns every markup'd node in compiler creation order
 * (post-order: descendants before parents — the markup root is last), which
 * is the same sequence imperative creation emitted and the same sequence
 * hydration plans expect.
 *
 * Modes:
 *   client-create — parse once into a cached <template>, cloneNode(true)
 *                   per instance; far cheaper than per-node createElement.
 *   hydrate       — HydrationController.claimMarkup claims each node
 *                   through the active creation plan (marker-aware,
 *                   fully validated, no real DOM construction).
 *   server modes  — the injected DocumentLike supplies materializeMarkup
 *                   (StringDocument interprets markup through its own
 *                   factories, keeping SSR output byte-identical). The
 *                   markup parser stays out of browser bundles.
 */

import { getActiveEnvironment } from './kernel';
import type { DocumentLike } from './environment';

const templates = new WeakMap<DocumentLike, Map<string, Element>>();

/** One compiled template's built nodes, per document and namespace (`cloneTemplate`). */
export interface TemplateCache {
  document: DocumentLike | null;
  html: Node | null;
  svg: Node | null;
}

export function createTemplateCache(): TemplateCache {
  return { document: null, html: null, svg: null };
}

/**
 * A copy of the nodes `build` creates, built once per document and namespace,
 * as the old compiler's row templates were: text slots are text nodes in the
 * template, and the compiled code reaches each node through `firstChild` and
 * `nextSibling`. Null while hydrating, which claims existing nodes, and for a
 * server document, which produces its own output; the caller then creates
 * its nodes the general way.
 */
export function cloneTemplate(
  cache: TemplateCache,
  namespace: 'html' | 'svg' | undefined,
  build: (document: DocumentLike, namespace: 'html' | 'svg') => Node,
): Node | null {
  const environment = getActiveEnvironment();
  const document = environment.document;
  if (environment.hydration !== undefined || document.materializeMarkup !== undefined) return null;
  if (cache.document !== document) {
    cache.document = document;
    cache.html = null;
    cache.svg = null;
  }
  if (namespace === 'svg') {
    cache.svg ??= build(document, 'svg');
    return cache.svg.cloneNode(true);
  }
  cache.html ??= build(document, 'html');
  return cache.html.cloneNode(true);
}

/**
 * Materialize one compiler-generated markup string. Returns nodes in
 * compiler creation order (post-order DFS — the markup root is last).
 */
export function materializeMarkup(markup: string): Node[] {
  const environment = getActiveEnvironment();
  const hydration = environment.hydration;
  if (hydration !== undefined) {
    return hydration.claimMarkup(markup);
  }
  const document = environment.document;
  if (document.materializeMarkup !== undefined) {
    return document.materializeMarkup(markup);
  }
  let documentTemplates = templates.get(document);
  if (documentTemplates === undefined) {
    documentTemplates = new Map();
    templates.set(document, documentTemplates);
  }
  let template = documentTemplates.get(markup);
  if (template === undefined) {
    template = document.createElement('template');
    (template as { innerHTML: string }).innerHTML = markup;
    documentTemplates.set(markup, template);
  }
  const clone = (
    template as unknown as { content: DocumentFragment }
  ).content.cloneNode(true);
  const nodes: Node[] = [];
  collectCreationOrder((clone as DocumentFragment).firstChild, null, nodes);
  return nodes;
}

/**
 * Post-order walk matching the compiler's creation order and the hydration
 * plan's collectCreationOrder for markup subtrees (markup contains no
 * structural markers — structural ranges stay imperative).
 */
function collectCreationOrder(
  start: Node | null,
  end: Node | null,
  output: Node[],
): void {
  let node = start;
  while (node !== null && node !== end) {
    collectCreationOrder(node.firstChild, null, output);
    output.push(node);
    node = node.nextSibling;
  }
}
