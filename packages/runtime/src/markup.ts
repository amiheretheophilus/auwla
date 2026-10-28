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

/**
 * compiler-next's description of a template's nodes:
 * - a string is a text node; a text slot is an empty one;
 * - null is a comment placeholder, for a region;
 * - `[tag, attributes, ...children]` is an element, with `attributes` a flat
 *   `[name, value, ...]` list, or 0 for none.
 */
export type TemplateNode = string | null | TemplateElement;
export interface TemplateElement extends ReadonlyArray<TemplateNode | readonly string[] | 0> {
  readonly 0: string;
  readonly 1: readonly string[] | 0;
}

/** One compiled template: its description and built nodes, per document and namespace. */
export interface TemplateCache {
  readonly roots: readonly TemplateNode[];
  document: DocumentLike | null;
  html: Node | null;
  svg: Node | null;
}

export function createTemplateCache(roots: readonly TemplateNode[]): TemplateCache {
  return { roots, document: null, html: null, svg: null };
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * The namespace follows the consuming slot, as the compiler plans it: an
 * `svg` tag starts SVG, and `foreignObject` restarts HTML below itself.
 */
function buildNode(document: DocumentLike, node: TemplateNode, namespace: 'html' | 'svg'): Node {
  if (node === null) return document.createComment('');
  if (typeof node === 'string') return document.createTextNode(node);
  const tag = node[0];
  const own = tag === 'svg' ? 'svg' : namespace;
  const element = own === 'svg' ? document.createElementNS(SVG_NAMESPACE, tag) : document.createElement(tag);
  const attributes = node[1];
  if (attributes !== 0) {
    for (let index = 0; index < attributes.length; index += 2) element.setAttribute(attributes[index]!, attributes[index + 1]!);
  }
  const inner = tag === 'foreignObject' ? 'html' : own;
  for (let index = 2; index < node.length; index++) element.appendChild(buildNode(document, node[index] as TemplateNode, inner));
  return element;
}

function buildTemplate(document: DocumentLike, roots: readonly TemplateNode[], namespace: 'html' | 'svg'): Node {
  if (roots.length === 1) return buildNode(document, roots[0]!, namespace);
  const fragment = document.createDocumentFragment();
  for (const root of roots) fragment.appendChild(buildNode(document, root, namespace));
  return fragment;
}

/**
 * A copy of the template's nodes, built once per document and namespace, as
 * the old compiler's row templates were: text slots are text nodes in the
 * template, and the compiled code reaches each node through `firstChild` and
 * `nextSibling`. Several roots arrive in a fragment. A server document builds
 * and clones its own nodes the same way. compiler-next emits no hydration
 * yet (Phase 10), so a hydrating environment is refused rather than given
 * new nodes in place of the ones it should claim.
 */
export function cloneTemplate(cache: TemplateCache, namespace?: 'html' | 'svg'): Node {
  const environment = getActiveEnvironment();
  const document = environment.document;
  if (environment.hydration !== undefined) {
    throw new Error('memo-dom: compiler-next output cannot hydrate yet');
  }
  if (cache.document !== document) {
    cache.document = document;
    cache.html = null;
    cache.svg = null;
  }
  if (namespace === 'svg') {
    cache.svg ??= buildTemplate(document, cache.roots, 'svg');
    return cache.svg.cloneNode(true);
  }
  cache.html ??= buildTemplate(document, cache.roots, 'html');
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
