import { whileApplicationMounted } from '@memoized-dom/runtime';
import type { CoreRouteRuntime } from './runtime';
import { enableNavigationBlockers } from './navigation-blockers';
import { enableResolverInstallation } from './resolver-installation';
import { enableGeneralNavigation } from './general-navigation';
import { readRouteRegion, trackRouteRead } from './route-reads';
import type {
  RouteNavigationBlocker as Blocker,
  RouteResolver,
  RouteState,
  RouteSelector,
} from './types';
import {
  activeRoute,
  connect as activeConnect,
  getActiveRouteRuntime,
  navigate as activeNavigate,
  navigateRelative as activeNavigateRelative,
  noteManifestResolver,
  notePreparedManifestResolver,
  setApplicationBasePath,
  subscribe as activeSubscribe,
  subscribeNavigation as activeSubscribeNavigation,
  subscribeSelected as activeSubscribeSelected,
} from './active-runtime';
import {
  invokeServerRoutedPreparation,
  prepareInitialRoutedRuntime,
  readRoutedPreparation as readPreparedValue,
  registerRoutedPreparation,
  restoreRoutedPreparationState,
  RoutedPreparationRedirectError,
  serializeRoutedPreparationState,
} from './preparation';
import {
  prepareInitialRouteModules as prepareInitialModules,
  readRouteModuleState,
  readRouteComponent,
  registerRouteComponent,
  subscribeRouteModuleState,
} from './route-modules';
export type {
  RouteModuleListener,
  RouteModuleState,
  RoutedServerContext,
  SerializedRoutedPreparationState,
} from './preparation';

export const route = activeRoute;
export { routeRegionIdentity } from './region-identity';

/**
 * The identity of compiled route region `id` in the active route, or null while it does not
 * match, read so the running computation follows it (`route-reads.ts`).
 */
export function routeRegion(id: string): string | null {
  return readRouteRegion(getActiveRouteRuntime(), id);
}

/**
 * `'page'` while a `route-to` link's `href` is the page being shown, for its `aria-current`
 * (`compiler/src/features/routes/lower.ts`). A query or hash on either side changes nothing: the
 * page is the same. Read through `route.href`, so the link follows navigation.
 */
export function currentPage(href: string): 'page' | undefined {
  const here = new URL(activeRoute.href);
  return new URL(href, here).pathname === here.pathname ? 'page' : undefined;
}
export const navigateRoute = activeNavigate;

export { createRouteRuntime } from './runtime-full';
export { supportsNavigationAPI } from './runtime';
export { redirectRoute } from './types';
export { createRouteManifest } from './manifest';
export { createPreparedRouteMatcher } from './prepared-matcher';
import { createPreparedRouteMatcher, type PreparedRouteEntry } from './prepared-matcher';
export type {
  NavigationController,
  NavigationDestinationLike,
  NavigationEventLike,
  RouteEnvironment,
  RouteRuntime,
} from './runtime';
export type {
  RouteLocationSnapshot,
  RouteNavigation,
  RouteNavigationBlocker,
  RouteNavigationEvent,
  RouteNavigationListener,
  RouteNavigationResult,
  RouteNavigationSettledResult,
  RouteResolver,
} from './types';
export { createMemoryRouteHistory } from './history';
export type { RouteHistory } from './history';
export { buildRoutePath } from './path';

/** Compiler-runtime boundary. Application code should not need these calls. */
export const connectRouter = (): (() => void) => activeConnect();
const connections = new Map<CoreRouteRuntime, () => void>();
let followsApplications = false;

/**
 * Connect the active route runtime to its window (history events, route-link clicks). It connects
 * when the route table installs, since the first route is matched before the application mounts,
 * and stays connected while an application is mounted: unmounting releases the listeners, so an
 * application started later in the same window (another bundle, a test) gets its own clicks. A
 * later mount connects again.
 */
export function ensureRouterConnected(): void {
  connectActive();
  if (followsApplications) return;
  followsApplications = true;
  whileApplicationMounted(() => {
    connectActive();
    return () => {
      for (const disconnect of connections.values()) disconnect();
      connections.clear();
    };
  });
}

function connectActive(): void {
  const runtime = getActiveRouteRuntime();
  if (!connections.has(runtime)) connections.set(runtime, runtime.connect());
}
/**
 * Install a compiled route table (the compiler,`wiki/compiler/routes.md`): match locations with
 * it, on this runtime and every one activated later, and make clicks on route links navigate.
 * One call keeps the table out of the module's own bindings. `basePath`: the prefix the
 * application is mounted at (`/app`, the compiler's `base` option), set before the table matches.
 */
export function installRouteTable(entries: readonly PreparedRouteEntry[], basePath?: string): void {
  if (basePath !== undefined) setApplicationBasePath(basePath);
  const match = createPreparedRouteMatcher(entries);
  notePreparedManifestResolver((location) => match(location.pathname));
  ensureRouterConnected();
}
export function installRouteResolver(resolver: RouteResolver): () => void {
  return enableResolverInstallation(getActiveRouteRuntime()).installResolver(resolver);
}
export function replaceRouteResolver(resolver: RouteResolver): () => void {
  return noteManifestResolver(resolver);
}
export function replacePreparedRouteResolver(resolver: RouteResolver): () => void {
  return notePreparedManifestResolver(resolver);
}
export const navigateRouteRelative = activeNavigateRelative;
export function blockRouteNavigation(blocker: Blocker): () => void {
  return enableNavigationBlockers(getActiveRouteRuntime()).blockNavigation(blocker);
}
export const subscribeRouteNavigation = activeSubscribeNavigation;
export const subscribeRoute = activeSubscribe;
export const subscribeRouteSelected = activeSubscribeSelected;
export {
  readRouteComponent,
  readRouteModuleState,
  registerRouteComponent,
  subscribeRouteModuleState,
};
export function prepareInitialRouteModules(): Promise<void> {
  return prepareInitialModules(getActiveRouteRuntime());
}
/** Load and prepare before a fresh client mount; SSR already delivered its data. */
export async function prepareInitialRoute(): Promise<void> {
  const runtime = getActiveRouteRuntime();
  // Adoption normally restores this at mount(). Entry preparation happens
  // earlier, so deliver only the routed envelope now to avoid running gates twice.
  if (typeof document !== 'undefined') {
    const script = document.querySelector('script[type="application/mmd+json"][data-mmd-root]');
    if (script?.textContent) {
      try {
        const payload = JSON.parse(script.textContent);
        if (payload?.version === 1 && payload.routed !== undefined) {
          restoreRoutedPreparationState(runtime, payload.routed);
        }
      } catch {
        // Malformed payloads cannot substitute for actual preparation.
      }
    }
  }
  const outcome = await prepareInitialRoutedRuntime(runtime, { reusePrepared: true });
  if (outcome.kind === 'redirect') {
    const result = enableGeneralNavigation(runtime).navigate(outcome.redirect.to.toString(), {
      replace: outcome.redirect.replace ?? true,
      state: outcome.redirect.state ?? null,
    });
    const settled = result.status === 'preparing' ? await result.finished : result;
    if (settled.status === 'blocked') {
      throw new RoutedPreparationRedirectError(outcome.redirect);
    }
  }
}
export {
  invokeServerRoutedPreparation,
  prepareInitialRoutedRuntime,
  registerRoutedPreparation,
  restoreRoutedPreparationState,
  RoutedPreparationRedirectError,
  serializeRoutedPreparationState,
};
/**
 * A route's prepared value. Reported as a read of the route's location (`route-reads.ts`): a
 * navigation that keeps the page but prepares it again (a new query) commits new values, which
 * compiled code then reads again.
 */
export function readRoutedPreparation(id: string): unknown {
  const runtime = getActiveRouteRuntime();
  trackRouteRead(runtime, 'href');
  return readPreparedValue(runtime, id);
}

/** Subscribe to navigation changes without treating subscription setup as one. */
export function subscribeRouteValue(
  _value: RouteState,
  listener: () => void,
): () => void {
  let initialized = false;
  return activeSubscribe(() => {
    if (!initialized) {
      initialized = true;
      return;
    }
    listener();
  });
}

/** Selected component reads skip the subscription's initial notification. */
export function subscribeRouteSelectedValue<Value>(
  selector: RouteSelector<Value>,
  listener: () => void,
): () => void {
  let initialized = false;
  return activeSubscribeSelected(selector, () => {
    if (!initialized) {
      initialized = true;
      return;
    }
    listener();
  });
}
