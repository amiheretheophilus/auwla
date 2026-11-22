/** Server page content shown in a compiled child site (`render-value.ts`). */
import type { Creations } from './adoption';
import { getActiveEnvironment } from './kernel';
import { pageBinder, pageBindingInputs, type PageBindingHandle, type PageContent } from './page-content';
import { updatePageRegions } from './page-regions';

/**
 * A page's nodes: its HTML, then its styles. On a server each is a node that prints `current()`'s
 * content when serialized, so a later generation is what the document gets.
 *
 * The HTML is one creation (`adoption.ts`): the server numbers it, and a browser adopting the
 * server's page takes that element when the page's HTML has it as its one root, so what the user
 * typed or focused in it survives hydration. Before 2026-11-22 the page was never numbered: the
 * browser dropped the server's page and parsed its HTML again, resetting a streamed page's input
 * (`progressive-server-pages`). Styles are parsed again either way.
 */
function pageNodes(value: PageContent, current: () => PageContent, creations: Creations | undefined): Node[] {
  const document = getActiveEnvironment().document;
  const id = creations?.next();
  if (document.htmlWriter) {
    const html = document.htmlWriter.create(() => current().html);
    if (id !== undefined) creations!.note?.(html, id);
    const styles = document.htmlWriter.create(() => (current().styles ?? [])
      .map(css=>'<style data-mmd-page-style>'+css.replaceAll('<','\\3c ')+'</style>').join(''));
    return [html, styles];
  }
  const taken = id === undefined ? undefined : creations!.take?.(id);
  const template = document.createElement('template') as HTMLTemplateElement;
  template.innerHTML = value.html;
  const parsed: Node[] = Array.from(template.content.childNodes);
  const nodes = taken !== undefined && fitsPage(taken, parsed) ? [taken] : parsed;
  nodes.push(...(value.styles ?? []).map(css=>{const style=document.createElement('style');style.setAttribute('data-mmd-page-style','');style.textContent=css;return style;}));
  return nodes;
}

/**
 * Whether the server's page element is the page `parsed` holds: one root element of the same tag
 * and, for a progressive page, the same render generation. The server page's regions were
 * already filled in by the stream (`stream-regions.ts`), so its content is the page's.
 */
function fitsPage(taken: Node, parsed: readonly Node[]): boolean {
  if (parsed.length !== 1 || parsed[0]!.nodeType !== 1 || taken.nodeType !== 1) return false;
  const expected = parsed[0] as Element, server = taken as Element;
  return server.localName === expected.localName
    && server.getAttribute('data-mmd-page-render') === expected.getAttribute('data-mmd-page-render');
}

/** The element a progressive page's later regions are found in. */
function progressRoot(nodes: readonly Node[]): Element | undefined {
  return nodes.find(node => node.nodeType === 1 && !(node as Element).matches('style[data-mmd-page-style]')) as Element | undefined;
}

/** Runs the page's registered binding program over its one root element. */
function bindPage(value: PageContent, nodes: readonly Node[]): PageBindingHandle {
  const bind = pageBinder(value.binding!.key);
  const roots=nodes.filter(node=>node.nodeType !== 1 || !(node as Element).matches('style[data-mmd-page-style]'));
  if (!bind || roots.length !== 1 || roots[0]?.nodeType !== 1) {
    throw new Error(`memo-dom: server page binding contract is unavailable or has an invalid root (binding=${Boolean(bind)}, roots=${nodes.map(node=>node.nodeName).join(',')})`);
  }
  return bind(roots[0] as Element, pageBindingInputs(value.binding!));
}

/** A page mounted by the compiler's value slot (`render-value.ts`). */
export interface MountedPage {
  readonly nodes: readonly Node[];
  /** Whether `next` updates this page in place: the same bound page, or its next generation. */
  accepts(next: PageContent): boolean;
  /** A replacement still streaming its first generation: the current page stays until it completes. */
  holds(next: PageContent): boolean;
  update(next: PageContent): void;
  dispose(): void;
}

/**
 * Mounts server page content: its HTML, bound by its registered program when it has one, numbered
 * by `creations` (the value slot's region, `render-value.ts`). Later content of the same bound page gives
 * that program new inputs, keeping its local state; a later generation of a progressive page
 * fills in its regions.
 */
export function mountPage(value: PageContent, creations?: Creations): MountedPage {
  const environment = getActiveEnvironment();
  const server = environment.mode.startsWith('server-');
  let active = value;
  const nodes = pageNodes(value, () => active, creations);
  const root = !server && value.progress ? progressRoot(nodes) : undefined;
  let binding = value.binding && !server ? bindPage(value, nodes) : undefined;
  const sameGeneration = (next: PageContent) => next.progress !== undefined && active.progress !== undefined
    && next.id === active.id && next.progress.id === active.progress.id;
  return {
    nodes,
    accepts: (next) => sameGeneration(next) || (binding !== undefined && next.id === active.id && next.binding?.key === active.binding?.key),
    holds: (next) => next.progress !== undefined && !next.progress.complete && !sameGeneration(next),
    update(next) {
      if (next === active) return;
      if (sameGeneration(next)) {
        if (root !== undefined) updatePageRegions(root, active, next);
      } else if (binding !== undefined) {
        binding.update(pageBindingInputs(next.binding!));
      }
      active = next;
    },
    dispose() {
      const previous = binding;
      binding = undefined;
      previous?.dispose();
    },
  };
}

