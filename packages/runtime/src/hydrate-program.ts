/** Adoption of server HTML, with the payload handoff (`payload.ts`). */
import { installHydrationRuntime } from './mount';
import { HydrationMismatchError } from './hydration-error';
import { initializePayload } from './payload';
import { createApplication } from './mount-core';
import { adoptRoot, carriesCreations } from './adoption';
import { parseRootHydrationIdentity } from './hydration-marker';

export function installProgramHydration(): void {
  installHydrationRuntime((host, definition, serverRootId, options) => {
    try {
      if (serverRootId !== definition.id) {
        throw new HydrationMismatchError(
          definition.id,
          `<!--mmd:r:${definition.id}-->`,
          `<!--mmd:r:${serverRootId}-->`,
        );
      }
      // The server numbers the nodes it made, and the client render takes them (`adoption.ts`).
      // HTML without numbers came from the old compiler, which went on 2026-11-18, and its
      // claim plans with it: such a root is mounted again from nothing.
      const range = rootRange(host);
      if (range === null || !carriesCreations(range.open)) {
        throw new HydrationMismatchError(definition.id, 'numbered server HTML', 'server HTML without numbers');
      }
      return initializePayload(host, definition, () => adoptRoot(
        range.open, range.end, () => createApplication(host, definition),
        (error) => options.onHydrateError?.(error, 'region'),
      ));
    } catch (caught) {
      if (!(caught instanceof HydrationMismatchError)) throw caught;
      options.onHydrateError?.(caught, 'root');
      host.innerHTML = '';
      return createApplication(host, definition);
    }
  });
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

export { adoptRoot } from './adoption';
