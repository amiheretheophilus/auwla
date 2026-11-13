/** Optional lazy module cache; independent of routed data and transfer. */
import type {CoreRouteRuntime as RouteRuntime} from './runtime';
import type {RouteMatch} from './types';
import type {RoutedPreparationMetadata} from './preparation';
import {installRouteModuleLoader} from './preparation-capability';
import {awaitRouteWork} from './route-work';

const routeComponents = new Map<string, unknown>();
const loadingComponents = new Map<string, Promise<void>>();
/**
 * The loader that loaded each key's component. Route tables built from the same entries share it,
 * but another table (an app evaluated again, or a second build in the same page) has loaders of
 * its own: the same key there can name a different module, so its loader runs.
 */
const loadedBy = new Map<string, () => Promise<unknown>>();
/** How many times each key has been registered, so a load can tell it registered. */
const registrations = new Map<string, number>();

export type RouteModuleState =
  | { readonly status: 'idle' | 'loading' | 'ready'; readonly error: null }
  | { readonly status: 'error'; readonly error: unknown };

export type RouteModuleListener = (state: RouteModuleState) => void;

const idleModuleState: RouteModuleState = Object.freeze({ status: 'idle', error: null });
const moduleStates = new Map<string, RouteModuleState>();
const moduleListeners = new Map<string, Set<RouteModuleListener>>();

function setRouteModuleState(
  key: string,
  state: RouteModuleState,
  force = false,
): void {
  const previous = moduleStates.get(key);
  if (!force && previous?.status === state.status && previous.error === state.error) return;
  const snapshot = Object.freeze(state);
  moduleStates.set(key, snapshot);
  for (const listener of moduleListeners.get(key) ?? []) {
    try {
      listener(snapshot);
    } catch (error) {
      // Observer errors must not turn a successfully loaded module into a
      // failed import or prevent other observers from seeing its state.
      queueMicrotask(() => { throw error; });
    }
  }
}

export function readRouteModuleState(key: string): RouteModuleState {
  return moduleStates.get(key) ??
    (routeComponents.has(key)
      ? Object.freeze({ status: 'ready', error: null })
      : idleModuleState);
}

export function subscribeRouteModuleState(
  key: string,
  listener: RouteModuleListener,
): () => void {
  let listeners = moduleListeners.get(key);
  if (listeners === undefined) {
    listeners = new Set();
    moduleListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) moduleListeners.delete(key);
  };
}
/** Compiler-owned route module cache. Re-registration replaces an HMR predecessor. */
export function registerRouteComponent(key: string, component: unknown): unknown {
  if (typeof component !== 'function') {
    throw new TypeError(`memo-dom: lazy route component '${key}' is not a function export`);
  }
  routeComponents.set(key, component);
  registrations.set(key, (registrations.get(key) ?? 0) + 1);
  if (!loadingComponents.has(key)) {
    setRouteModuleState(key, { status: 'ready', error: null }, true);
  }
  return component;
}

export function readRouteComponent(key: string): (...args: unknown[]) => unknown {
  const component = routeComponents.get(key);
  if (typeof component !== 'function') {
    throw new Error(`memo-dom: lazy route component '${key}' was mounted before loading`);
  }
  return component as (...args: unknown[]) => unknown;
}

export async function prepareRouteModules(
  matches: readonly RouteMatch[],
  signal: AbortSignal,
): Promise<void> {
  for (const match of matches) {
    const metadata = match.metadata as RoutedPreparationMetadata | undefined;
    const key = metadata?.componentKey;
    const loader = metadata?.moduleLoader;
    if (key === undefined || loader === undefined) continue;
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('Route loading was superseded', 'AbortError');
    }
    let loading = loadingComponents.get(key);
    if (loading === undefined && routeComponents.has(key) && loadedBy.get(key) === loader) continue;
    if (loading === undefined) {
      // The page on screen may still read the component another loader registered, so it stays
      // until this load registers its own; the count tells whether it did.
      const registered = registrations.get(key) ?? 0;
      loading = Promise.resolve().then(loader).then(() => {
        if (!routeComponents.has(key) || (registrations.get(key) ?? 0) === registered) {
          throw new Error(`memo-dom: lazy route component '${key}' did not register`);
        }
        loadedBy.set(key, loader);
        setRouteModuleState(key, { status: 'ready', error: null });
      }).catch(error => {
        if (loadingComponents.get(key) === loading) loadingComponents.delete(key);
        routeComponents.delete(key);
        setRouteModuleState(key, { status: 'error', error });
        throw error;
      }).finally(() => {
        if (loadingComponents.get(key) === loading) loadingComponents.delete(key);
      });
      loadingComponents.set(key, loading);
      setRouteModuleState(key, { status: 'loading', error: null });
    }
    await awaitRouteWork(loading, signal);
    if (signal.aborted) {
      throw signal.reason ?? new DOMException('Route loading was superseded', 'AbortError');
    }
  }
}

export async function prepareInitialRouteModules(runtime: RouteRuntime): Promise<void> {
  await prepareRouteModules(runtime.route.matches, runtime.route.signal);
}


installRouteModuleLoader(prepareRouteModules);
