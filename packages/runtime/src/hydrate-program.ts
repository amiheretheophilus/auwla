/** General adoption uses the same payload handoff as fixed initial bindings. */
import { installHydrationRuntime } from './mount';
import { hydrateApplicationRoot, type HydrationCapabilities } from './hydration';
import { HydrationMismatchError } from './hydration-error';
import { initializePayload } from './payload';
import { rootNodes } from './jsx-dom';
import { createApplication, createMountedApplication } from './mount-core';
import { adoptRoot, carriesCreations } from './adoption';
import { parseRootHydrationIdentity } from './hydration-marker';

export function installProgramHydration(capabilities: HydrationCapabilities): void {
  const shared = installHydrationRuntime((host, definition, serverRootId, options) => {
    try {
      if (serverRootId !== definition.id) {
        throw new HydrationMismatchError(
          definition.id,
          `<!--mmd:r:${definition.id}-->`,
          `<!--mmd:r:${serverRootId}-->`,
        );
      }
      // compiler-next's server HTML numbers its nodes: the client render takes them (`adoption.ts`).
      const range = rootRange(host);
      if (range !== null && carriesCreations(range.open)) {
        return initializePayload(host, definition, () => adoptRoot(range.open, range.end, () => createApplication(host, definition)));
      }
      return initializePayload(host, definition, () => {
        const adopted = hydrateApplicationRoot(host, definition, shared);
        const mounted = createMountedApplication(
          host, definition, rootNodes(adopted.root), adopted.disposeMarkers,
        );
        for (const error of adopted.recovered) options.onHydrateError?.(error, 'region');
        return mounted;
      }, error => error instanceof HydrationMismatchError);
    } catch (error) {
      if (!(error instanceof HydrationMismatchError)) throw error;
      options.onHydrateError?.(error, 'root');
      host.innerHTML = '';
      return createApplication(host, definition);
    }
  }, capabilities);
}

/** The server root's marker pair among the host's children. */
function rootRange(host: Element): { open: Node; end: Node } | null {
  let open: Node | null = null;
  for (let node = host.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType !== 8) continue;
    if (open === null && parseRootHydrationIdentity((node as Comment).data) !== null) open = node;
  }
  // A region at the top of the page closes with `/mmd` too; the root's close is the last.
  let end: Node | null = host.lastChild;
  while (end !== null && !(end.nodeType === 8 && (end as Comment).data === '/mmd')) end = end.previousSibling;
  return open === null || end === null || end === open ? null : { open, end };
}

export { hydrateList } from './hydration-list';
export { hydrateMarkup } from './hydration-markup';
export { adoptRoot } from './adoption';
