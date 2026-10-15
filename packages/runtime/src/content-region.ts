/** Remote render values reuse existing anchored conditional ownership. */
import { createCondRegion } from './cond';
import { getActiveEnvironment } from './kernel';
import { isRenderablePage as isPageContent, pageBinder, pageBindingInputs, type PageBindingHandle } from './page-content';
import { textValue } from './setters';
import { HydrationMismatchError } from './hydration-error';
import { updatePageRegions } from './page-regions';

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
      const document = environment.document;
      if (document.htmlWriter) {
        const initialPage = value;
        nodes = [document.htmlWriter.create(() => {
          const page = isPageContent(active) ? active : initialPage;
          return (page.styles ?? []).map(css=>'<style data-mmd-page-style>'+css.replaceAll('<','\\3c ')+'</style>').join('')+page.html;
        })];
      }
      else {
        const template = document.createElement('template') as HTMLTemplateElement;
        template.innerHTML = value.html;
        nodes = Array.from(template.content.childNodes);
        nodes.unshift(...(value.styles ?? []).map(css=>{const style=document.createElement('style');style.setAttribute('data-mmd-page-style','');style.textContent=css;return style;}));
      }
    } else nodes = [environment.document.createTextNode(textValue(value))];
    pageRoot = !environment.mode.startsWith('server-') && isPageContent(value) && value.progress ? nodes.find(node => node.nodeType === 1 && !(node as Element).matches('style[data-mmd-page-style]')) as Element | undefined : undefined;
    if (isPageContent(value) && value.binding && !environment.mode.startsWith('server-')) {
      const bind = pageBinder(value.binding.key);
      const roots=nodes.filter(node=>node.nodeType !== 1 || !(node as Element).matches('style[data-mmd-page-style]'));
      if (!bind || roots.length !== 1 || roots[0]?.nodeType !== 1) {
        throw new Error(`memo-dom: server page binding contract is unavailable or has an invalid root (binding=${Boolean(bind)}, roots=${nodes.map(node=>node.nodeName).join(',')})`);
      }
      binding = bind(roots[0] as Element, pageBindingInputs(value.binding));
    }
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
