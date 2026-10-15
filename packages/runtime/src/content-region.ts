/** Remote render values reuse existing anchored conditional ownership. */
import { createCondRegion } from './cond';
import { getActiveEnvironment } from './kernel';
import { isPageContent, pageBinder, type PageBindingHandle } from './page-content';
import { textValue } from './setters';
import { HydrationMismatchError } from './hydration-error';

export function createContentRegion(parent: Node, id: string, read: () => unknown) {
  let value: unknown;
  let binding: PageBindingHandle | undefined;
  let active: unknown;
  let identity: unknown;
  const region = createCondRegion(parent, id, () => {
    value = read();
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
      if (document.htmlWriter) { const html = value.html; nodes = [document.htmlWriter.create(() => html)]; }
      else {
        const template = document.createElement('template') as HTMLTemplateElement;
        template.innerHTML = value.html;
        nodes = Array.from(template.content.childNodes);
      }
    } else nodes = [environment.document.createTextNode(textValue(value))];
    if (isPageContent(value) && value.binding && !environment.mode.startsWith('server-')) {
      const bind = pageBinder(value.binding.key);
      if (!bind || nodes.length !== 1 || nodes[0]?.nodeType !== 1) {
        throw new Error(`memo-dom: server page binding contract is unavailable or has an invalid root (binding=${Boolean(bind)}, roots=${nodes.map(node=>node.nodeName).join(',')})`);
      }
      binding = bind(nodes[0] as Element, value.binding.inputs);
    }
    return {
      nodes,
      update() {
        if (binding && isPageContent(value) && value !== active) {
          binding.update(value.binding!.inputs);
          active = value;
        }
      },
      dispose() { const previous = binding; binding = undefined; previous?.dispose(); active = undefined; },
    };
  }], () => identity);
  return region;
}
