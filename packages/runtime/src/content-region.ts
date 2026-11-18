/** Server page content shown in a compiled child site (`render-value.ts`). */
import { getActiveEnvironment } from './kernel';
import { pageBinder, pageBindingInputs, type PageBindingHandle, type PageContent } from './page-content';
import { updatePageRegions } from './page-regions';

/**
 * A page's nodes: its styles and HTML. On a server they are one node that prints `current()`'s
 * HTML when serialized, so a later generation is what the document gets.
 */
function pageNodes(value: PageContent, current: () => PageContent): Node[] {
  const document = getActiveEnvironment().document;
  if (document.htmlWriter) {
    return [document.htmlWriter.create(() => {
      const page = current();
      return (page.styles ?? []).map(css=>'<style data-mmd-page-style>'+css.replaceAll('<','\\3c ')+'</style>').join('')+page.html;
    })];
  }
  const template = document.createElement('template') as HTMLTemplateElement;
  template.innerHTML = value.html;
  const nodes: Node[] = Array.from(template.content.childNodes);
  nodes.unshift(...(value.styles ?? []).map(css=>{const style=document.createElement('style');style.setAttribute('data-mmd-page-style','');style.textContent=css;return style;}));
  return nodes;
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

/** A page mounted by compiler-next's value slot (`render-value.ts`). */
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
 * Mounts server page content: its HTML, bound by its registered program when it has one. Later content of the same bound page gives
 * that program new inputs, keeping its local state; a later generation of a progressive page
 * fills in its regions.
 */
export function mountPage(value: PageContent): MountedPage {
  const environment = getActiveEnvironment();
  const server = environment.mode.startsWith('server-');
  let active = value;
  const nodes = pageNodes(value, () => active);
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

