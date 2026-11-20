/**
 * What a navigation is waiting for: `route.pending`, `route.next`, and the attributes CSS can use
 * while a page loads (`README.md`, "Showing that a page is loading").
 *
 * A navigation waits while a `$routed` loader runs or a lazy route's chunk downloads: the router
 * holds a preparation for it then (`runtime.ts`). The router tells this when that changes, which
 * can happen twice in one task, as a navigation with nothing to wait for starts and finishes at
 * once. So the change is looked at a microtask later, and a flip back reaches nobody.
 *
 * While a page loads, in a connected browser runtime:
 * - `<html>` has `data-navigating`;
 * - each link to the page being loaded has `aria-busy="true"`, which screen readers announce.
 * The framework writes attributes, never classes: `class` is the author's, and their components
 * write it again whenever its value changes.
 */
import type { RouteNavigationLocation } from './types';

export interface WaitingOptions {
  readonly document?: Document;
  /** Where the router's current preparation is going, or null when there is none. */
  readonly destination: () => RouteNavigationLocation | null;
  /** Whether the runtime drives a page: a server's runtime touches no document. */
  readonly connected: () => boolean;
  /** Called after `next` changed. */
  readonly publish: () => void;
}

export interface Waiting {
  /** The page being loaded, as last published, or null. */
  readonly next: RouteNavigationLocation | null;
  /** The router's preparation changed; look again a microtask later. */
  note(): void;
  dispose(): void;
}

const NAVIGATING = 'data-navigating';
const BUSY = 'aria-busy';

export function createWaiting(options: WaitingOptions): Waiting {
  let next: RouteNavigationLocation | null = null;
  let queued = false;
  let disposed = false;
  /** Links this marked busy, so only those are cleared. */
  let busy: Element[] = [];

  function settle(): void {
    queued = false;
    if (disposed) return;
    const destination = options.destination();
    if (destination === next) return;
    next = destination;
    mark();
    options.publish();
  }

  function mark(): void {
    clear();
    const document = options.document;
    if (document === undefined || next === null || !options.connected()) return;
    document.documentElement.setAttribute(NAVIGATING, '');
    const target = new URL(next.href);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (link.hasAttribute(BUSY) || !sameDocument(link.href, target)) continue;
      link.setAttribute(BUSY, 'true');
      busy.push(link);
    }
  }

  function clear(): void {
    options.document?.documentElement.removeAttribute(NAVIGATING);
    for (const link of busy) link.removeAttribute(BUSY);
    busy = [];
  }

  return {
    get next() {
      return next;
    },
    note() {
      if (queued || disposed) return;
      queued = true;
      queueMicrotask(settle);
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

/** Whether a link goes to the same page as `target`: the hash only scrolls it. */
function sameDocument(href: string, target: URL): boolean {
  try {
    const url = new URL(href);
    return url.origin === target.origin && url.pathname === target.pathname && url.search === target.search;
  } catch {
    return false;
  }
}
