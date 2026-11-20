import type { RouteMatch, RouteState } from './types';

/**
 * Each region's identity, per matches array. A navigation freezes a new array (`runtime.ts`), so an
 * array's identities never change, and a page reading its regions again (every route region reads
 * its own twice: to choose, and as its component's key) gets the string it made the first time.
 */
const identities = new WeakMap<readonly RouteMatch[], Map<string, string | null>>();

/** @internal Identity of one matched region, excluding query/hash refreshes. */
export function routeRegionIdentity(route: RouteState, id: string): string | null {
  const matches = route.matches;
  let known = identities.get(matches);
  if (known === undefined) {
    known = new Map();
    identities.set(matches, known);
  }
  const cached = known.get(id);
  if (cached !== undefined) return cached;

  const match = matches.find(candidate => candidate.id === id);
  // The consumed pathname contains inherited as well as local parameters.
  // Child changes therefore leave an unchanged parent layout instance intact.
  const identity = match === undefined ? null : JSON.stringify([id, match.pathname]);
  known.set(id, identity);
  return identity;
}
