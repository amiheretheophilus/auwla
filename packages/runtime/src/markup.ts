/**
 * markup.ts - the compiler's templates: a static subtree described as data
 * (`TemplateNode`), built once per document and namespace and cloned per
 * instance. The old compiler's markup strings (`materializeMarkup`, with the
 * server's markup parser) went with it on 2026-11-18.
 */

import { getActiveEnvironment } from './kernel';
import type { DocumentLike } from './environment';
import { adoptTemplate, noteTemplate, unnumbered } from './adoption';

/**
 * The compiler's description of a template's nodes:
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
 * and clones its own nodes the same way.
 *
 * A clone is a creation (`adoption.ts`): a server numbers it, and a browser
 * adopting server HTML takes the server's nodes for it when they fit.
 */
export function cloneTemplate(cache: TemplateCache, namespace?: 'html' | 'svg'): Node {
  const environment = getActiveEnvironment();
  // Template nodes are not creations (`adoption.ts`), so they come from the unnumbered document.
  const document = unnumbered(environment.document);
  const creations = environment.creations;
  const id = creations === undefined ? '' : creations.next();
  if (creations !== undefined) {
    creations.cloned = true;
    const adopted = creations.take === undefined ? null : adoptTemplate(creations, id, cache.roots, namespace ?? 'html');
    if (adopted !== null) return adopted;
  }
  if (cache.document !== document) {
    cache.document = document;
    cache.html = null;
    cache.svg = null;
  }
  let clone: Node;
  if (namespace === 'svg') {
    cache.svg ??= buildTemplate(document, cache.roots, 'svg');
    clone = cache.svg.cloneNode(true);
  } else {
    cache.html ??= buildTemplate(document, cache.roots, 'html');
    clone = cache.html.cloneNode(true);
  }
  if (creations?.note !== undefined) noteTemplate(creations, id, clone, cache.roots.length);
  return clone;
}
