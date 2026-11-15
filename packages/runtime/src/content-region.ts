/** Remote render values reuse existing anchored conditional ownership. */
import { createCondRegion } from './cond';
import { getActiveEnvironment } from './kernel';
import { isRenderablePage as isPageContent, pageBinder, pageBindingInputs, type PageBindingHandle, type PageContent } from './page-content';
import { textValue } from './setters';
import { HydrationMismatchError } from './hydration-error';
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
 * Mounts server page content, as `createContentRegion` does for the old compiler: its HTML,
 * bound by its registered program when it has one. Later content of the same bound page gives
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

export function createContentRegion(parent: Node, id: string, read: () => unknown) {
  let value: unknown;
  let binding: PageBindingHandle | undefined;
  let active: unknown;
  let identity: unknown;
  let pageRoot: Element | undefined;
  let holding = false;
  const region = createCondRegion(parent, id, () => {
    value = read();
    holding = false;
    if (isPageContent(value) && isPageContent(active) && value.progress) {
      if (value.id === active.id && value.progress.id === active.progress?.id) return 0;
      // Revalidation/replacement keeps the committed generation until the new
      // one is complete. A first visit still displays its available shell.
      if (!value.progress.complete) { holding = true; return 0; }
    }
    // Reuse a compatible binding program: new server inputs update its guarded
    // bindings without resetting independent local state. A different contract
    // or a noninteractive render replaces the range and drains the old owner.
    if (isPageContent(value) && isPageContent(active) && binding &&
        value.id === active.id && value.binding?.key === active.binding?.key) {
      return 0;
    }
    identity = value;
    return value == null || typeof value === 'boolean' ? -1 : 0;
  }, [(_adoptingInitial, hydrating) => {
    const environment = getActiveEnvironment();
    active = value;
    let nodes: Node[];
    if (hydrating && environment.hydration?.claimOpaqueContent) {
      nodes = environment.hydration.claimOpaqueContent();
      if (isPageContent(value) && value.html && nodes.length === 0) throw new HydrationMismatchError(id,'server-owned HTML','an empty range');
    } else if (isPageContent(value)) {
      const initialPage = value;
      nodes = pageNodes(value, () => isPageContent(active) ? active : initialPage);
    } else nodes = [environment.document.createTextNode(textValue(value))];
    pageRoot = !environment.mode.startsWith('server-') && isPageContent(value) && value.progress ? progressRoot(nodes) : undefined;
    if (isPageContent(value) && value.binding && !environment.mode.startsWith('server-')) binding = bindPage(value, nodes);
    return {
      nodes,
      update() {
        if (holding) return;
        if (isPageContent(active) && isPageContent(value) && active.progress && value.progress && value !== active &&
            active.progress?.id === value.progress?.id) {
          if (pageRoot && !environment.mode.startsWith('server-')) updatePageRegions(pageRoot, active, value);
          active = value;
        }
        if (binding && isPageContent(value) && value !== active) {
          binding.update(pageBindingInputs(value.binding!));
          active = value;
        }
      },
      dispose() { const previous = binding; binding = undefined; previous?.dispose(); active = undefined; pageRoot = undefined; },
    };
  }], () => identity);
  return region;
}
