/**
 * Reads of the active route that compiled code follows (`wiki/compiler/routes.md`).
 *
 * compiler-next runs a read it cannot see into, such as `route.pathname` or a route region's
 * `routeRegion(id)`, inside a computation of the runtime, which records what the read reports
 * through `trackRead`. A navigation then publishes only the keys whose value changed:
 *
 * - one key per field of the `route` facade: `route.params.id` runs again when the params change,
 *   not when only the hash does. `query` is one field, compared by the search string, since a
 *   stored `route.query` must change whenever any of it does;
 * - one key per route region, which changes only when that region opens, closes or matches a
 *   different path. A query change, or a child route changing below an unchanged layout, wakes
 *   nothing there.
 *
 * The bookkeeping lives in the application runtime that read it, so a server rendering many
 * requests, or a test running many apps, keeps each one's apart. A route runtime's listener holds
 * it weakly: once that application is gone, the listener removes itself on the next navigation.
 * Nothing is set up for a read made outside a computation, which nobody follows.
 */
import {
  enterCallback,
  getActiveApplicationRuntime,
  getExtensionStore,
  leaveCallback,
  publishVersions,
  runWithApplicationRuntime,
  trackRead,
  tracking,
} from '@memoized-dom/runtime';
import { routeRegionIdentity } from './region-identity';
import type { CoreRouteRuntime } from './runtime';
import type { RouteState } from './types';

/** One followed value: what readers last saw published, and the key a change publishes. */
interface Followed<T> {
  value: T;
  version: number;
  readonly key: object;
  readonly current: () => number;
}

/** What one application follows of one route runtime. */
interface RouteReads {
  readonly fields: Map<keyof RouteState, Followed<unknown>>;
  readonly regions: Map<string, Followed<string | null>>;
}

function followed<T>(value: T): Followed<T> {
  const entry: Followed<T> = { value, version: 0, key: {}, current: () => entry.version };
  return entry;
}

/**
 * What a field's readers depend on, comparable with `Object.is`. A new params object with the
 * same values, or new matches over the same paths, is no change to them.
 */
function fieldValue(route: RouteState, field: keyof RouteState): unknown {
  switch (field) {
    case 'query':
      return route.search;
    case 'params':
      return JSON.stringify(Object.entries(route.params).sort(([left], [right]) => left < right ? -1 : 1));
    case 'matches':
      return JSON.stringify(route.matches.map((match) => [match.id, match.pathname]));
    case 'matched':
      return route.matched === null ? null : JSON.stringify([route.matched.id, route.matched.pathname]);
    default:
      return route[field];
  }
}

/** This application's reads of `runtime`, subscribing to its navigations the first time. */
function readsOf(runtime: CoreRouteRuntime): RouteReads {
  const all = getExtensionStore('mmd:route-reads', () => new WeakMap<CoreRouteRuntime, RouteReads>());
  const known = all.get(runtime);
  if (known !== undefined) return known;

  const reads: RouteReads = { fields: new Map(), regions: new Map() };
  all.set(runtime, reads);

  const application = getActiveApplicationRuntime();
  const held = new WeakRef(reads);
  let subscribed = false;
  let unsubscribe = (): void => {};

  // Every publication of the route reaches the listener (`equals` never holds); it works out what
  // changed itself. The first call is the subscription's own, before any navigation.
  unsubscribe = runtime.subscribeSelected((route) => route, () => {
    if (!subscribed) return;
    const state = held.deref();
    if (state === undefined) {
      unsubscribe();
      return;
    }
    runWithApplicationRuntime(application, () => publishChanges(runtime, state));
  }, () => false);
  subscribed = true;

  return reads;
}

/**
 * Publish the key of each field and region whose value changed. A navigation commits what it
 * changed as it returns, as an event handler does (`enterCallback`), rather than a microtask
 * later; inside a handler that navigates, the handler's return commits it.
 */
function publishChanges(runtime: CoreRouteRuntime, reads: RouteReads): void {
  const keys: object[] = [];
  const publishIfChanged = <T>(entry: Followed<T>, value: T) => {
    if (Object.is(value, entry.value)) return;
    entry.value = value;
    entry.version++;
    keys.push(entry.key);
  };

  for (const [field, entry] of reads.fields) publishIfChanged(entry, fieldValue(runtime.route, field));
  for (const [id, region] of reads.regions) publishIfChanged(region, routeRegionIdentity(runtime.route, id));
  if (keys.length === 0) return;

  enterCallback();
  publishVersions(keys);
  leaveCallback(undefined);
}

/** Report a read of one field of `runtime`'s route, for the `route` facade's getters. */
export function trackRouteRead(runtime: CoreRouteRuntime, field: keyof RouteState): void {
  if (!tracking()) return;
  const reads = readsOf(runtime);
  let entry = reads.fields.get(field);
  if (entry === undefined) {
    entry = followed(fieldValue(runtime.route, field));
    reads.fields.set(field, entry);
  }
  trackRead(entry.current, undefined, entry.key);
}

/**
 * The identity of route region `id` in `runtime`'s route, or null while it does not match: what a
 * compiled route region opens on and keys its content by, so a new path remounts it.
 */
export function readRouteRegion(runtime: CoreRouteRuntime, id: string): string | null {
  // Always the route itself, not what was last published: a region can be read between a
  // navigation and its publication, and a server request's route never publishes at all.
  const identity = routeRegionIdentity(runtime.route, id);
  if (!tracking()) return identity;

  const reads = readsOf(runtime);
  let region = reads.regions.get(id);
  if (region === undefined) {
    region = followed(identity);
    reads.regions.set(id, region);
  }
  return trackRead(region.current, identity, region.key);
}
