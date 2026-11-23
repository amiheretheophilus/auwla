import {
  createRouteMatcher,
  matchRoutePattern,
  normalizeRoutePath,
  validateRoutePattern,
  validateRoutePatterns,
  type RouteTableMatcher,
} from '@memoized-dom/router';
import {
  invokeServerRoutedPreparation,
  type RoutedServerContext,
} from '@memoized-dom/router/internal';
import type { StandardSchemaV1 } from '@memoized-dom/data';
import type { LiveKey, LiveRefreshPlan } from './live';
import { createLiveSessions, LIVE_SESSION_PATH } from './live-session';
import type { ServerSocketSession } from './websocket/definition';
import { LIVE_HEARTBEAT_INTERVAL, resolveLiveHeartbeatInterval } from './live-heartbeat';
import {
  normalizeHandlerResult,
  reportUnhandledError,
  SERVER_FUNCTION_ROUTE_KEY,
  streamErrorReporters,
  type InternalServerFunctionRoute,
} from './handler-results';

export { installServerPageFetch } from './handler-results';
export { createServerFunctionRoutes } from './server-function-routes';

/** Framework route used by compiler-extracted server-backed `$routed` work. */
export function invokeRoutedPreparation(
  input: {
    readonly id: string;
    readonly href: string;
    readonly params: Readonly<Record<string, string>>;
    readonly state?: Readonly<Record<string, unknown>>;
  },
  context: RoutedServerContext,
): Promise<unknown> {
  return invokeServerRoutedPreparation(input, context);
}

export type ServerHandlerResult = unknown;

/**
 * Application-owned server types merge into this interface through the
 * generated project declaration. Framework packages must leave it empty.
 */
export interface ServerTypeRegistry {}

type RegisteredApplication = ServerTypeRegistry extends {
  application: infer TApplication;
}
  ? TApplication
  : Record<string, never>;

export type RegisteredServerState = RegisteredApplication extends {
  state: infer TLocals extends object;
}
  ? TLocals
  : Record<string, never>;

export type RegisteredServerPlatform = RegisteredApplication extends {
  platform?: infer TPlatform;
}
  ? TPlatform
  : unknown;

export type RegisteredServerServices = RegisteredApplication extends {
  services: infer TServices extends object;
}
  ? TServices
  : Record<string, never>;

export interface ServerContext<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  readonly request: Request;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly state: TLocals;
  readonly platform: TPlatform | undefined;
  readonly services: TServices;
}

export type ServerHandler<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> = (
  context: ServerContext<TLocals, TPlatform, TServices>,
) => ServerHandlerResult | Promise<ServerHandlerResult>;

export type ServerMiddleware<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> = (
  context: ServerContext<TLocals, TPlatform, TServices>,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

export interface ServerRoute<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  readonly id?: string;
  readonly method: string | readonly string[];
  readonly path: string;
  readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform, TServices>[];
  readonly handler: ServerHandler<TLocals, TPlatform, TServices>;
}

export type ServerFunctionQueryKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]';

export interface ServerFunctionRouteParameter {
  readonly name: string;
  readonly optional: boolean;
  readonly queryKind?: ServerFunctionQueryKind;
}

export interface ServerFunctionRouteDefinition<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  readonly id: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: `/_fn/${string}`;
  /** The schema owns one transported value passed after context. */
  readonly schemaInput?: boolean;
  readonly parameters: readonly ServerFunctionRouteParameter[];
  readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform, TServices>[];
  /** Validates one transport value after request middleware. */
  readonly input?: StandardSchemaV1;
  readonly live?: (context: ServerContext<TLocals, TPlatform, TServices>, ...args: unknown[]) => LiveKey;
  readonly updates?: (context: ServerContext<TLocals, TPlatform, TServices>, ...args: unknown[]) => LiveKey;
  /** How often a live read is checked while someone reads it: milliseconds, or a callback choosing from each result. */
  readonly refresh?: LiveRefreshPlan;
  readonly handler: (
    context: ServerContext<TLocals, TPlatform, TServices>,
    ...args: unknown[]
  ) => ServerHandlerResult | Promise<ServerHandlerResult>;
}

export interface ServerSocketRouteDefinition<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> extends Omit<ServerFunctionRouteDefinition<TLocals, TPlatform, TServices>, 'method' | 'handler' | 'live' | 'updates' | 'refresh'> {
  readonly method: 'WEBSOCKET';
  readonly live: (context: ServerContext<TLocals, TPlatform, TServices>, ...args: unknown[]) => LiveKey;
  readonly handler: (
    context: ServerContext<TLocals, TPlatform, TServices>,
    ...args: unknown[]
  ) => ServerSocketSession<unknown> | Response | Promise<ServerSocketSession<unknown> | Response>;
}

export interface ServerMiddlewareGroup<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  readonly path: string;
  readonly middleware: readonly ServerMiddleware<TLocals, TPlatform, TServices>[];
}

export interface ServerDispatchOptions<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  /** Reuse request-owned state for a derived in-memory dispatch. */
  readonly state?: TLocals;
  readonly platform?: TPlatform;
  readonly services?: TServices;
}

export interface ServerRouterOptions<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  readonly routes: readonly ServerRoute<TLocals, TPlatform, TServices>[];
  readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform, TServices>[];
  readonly groups?: readonly ServerMiddlewareGroup<TLocals, TPlatform, TServices>[];
  readonly createState?: (request: Request) => TLocals;
  readonly createPlatform?: (request: Request) => TPlatform | undefined;
  readonly services?: TServices;
  /** Handles paths that have no HTTP route, such as an application page fallback. */
  readonly fallback?: ServerHandler<TLocals, TPlatform, TServices>;
  /** Idle live SSE keep-alive interval in milliseconds; defaults to 15,000. */
  readonly liveHeartbeatInterval?: number;
  readonly onError?: (
    error: unknown,
    context: ServerContext<TLocals, TPlatform, TServices>,
  ) => Response | Promise<Response>;
}

export interface ServerRouter<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  readonly fetch: (request: Request) => Promise<Response>;
  dispatch(
    request: Request,
    options?: ServerDispatchOptions<TLocals, TPlatform, TServices>,
  ): Promise<Response>;
  matches(pathname: string, method: string): boolean;
  allowedMethods(pathname: string): readonly string[];
}

interface PreparedRoute<TLocals extends object, TPlatform, TServices extends object> {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly middleware: readonly ServerMiddleware<TLocals, TPlatform, TServices>[];
  readonly handler: ServerHandler<TLocals, TPlatform, TServices>;
}

interface PreparedGroup<TLocals extends object, TPlatform, TServices extends object> {
  readonly path: string;
  readonly depth: number;
  readonly order: number;
  readonly middleware: readonly ServerMiddleware<TLocals, TPlatform, TServices>[];
}

interface RouteSelection<TLocals extends object, TPlatform, TServices extends object> {
  readonly route: PreparedRoute<TLocals, TPlatform, TServices>;
  readonly params: Readonly<Record<string, string>>;
}

interface MethodMatch<TLocals extends object, TPlatform, TServices extends object> {
  readonly route: PreparedRoute<TLocals, TPlatform, TServices>;
  readonly params: Readonly<Record<string, string>>;
}

const METHOD_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Z-]+$/;
const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze(
  Object.create(null) as Record<string, string>,
);
const DEFAULT_METHOD_ORDER = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];
function normalizeMethod(method: string): string {
  const normalized = method.toUpperCase();
  if (normalized === '' || !METHOD_TOKEN.test(normalized)) {
    throw new TypeError(`Invalid HTTP method '${method}'`);
  }
  return normalized;
}

function methodsFor(route: {
  readonly method: string | readonly string[];
  readonly path: string;
}): readonly string[] {
  const methods = typeof route.method === 'string'
    ? [route.method]
    : route.method;
  if (methods.length === 0) {
    throw new TypeError(`Route '${route.path}' must declare at least one HTTP method`);
  }
  return Object.freeze([...new Set(methods.map(normalizeMethod))]);
}

async function runMiddleware<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(
  middleware: readonly ServerMiddleware<TLocals, TPlatform, TServices>[],
  terminal: (
    context: ServerContext<TLocals, TPlatform, TServices>,
  ) => Promise<Response>,
  context: ServerContext<TLocals, TPlatform, TServices>,
): Promise<Response> {
  let activeIndex = -1;
  const run = async (index: number): Promise<Response> => {
    if (index <= activeIndex) {
      throw new Error('Server middleware called next() more than once');
    }
    activeIndex = index;
    const current = middleware[index];
    if (current === undefined) return terminal(context);
    return current(context, () => run(index + 1));
  };
  return run(0);
}

function methodRank(method: string): number {
  const index = DEFAULT_METHOD_ORDER.indexOf(method);
  return index === -1 ? DEFAULT_METHOD_ORDER.length : index;
}

function sortMethods(left: string, right: string): number {
  const rank = methodRank(left) - methodRank(right);
  return rank === 0 ? left.localeCompare(right) : rank;
}

function withoutBody(response: Response): Response {
  // Cancelling the discarded body stops any work still producing it, such
  // as a streamed SSR render.
  void response.body?.cancel().catch(() => {});
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Create a portable method-aware HTTP dispatcher over Web Request/Response.
 * Rendering and filesystem discovery deliberately live above this layer.
 */
export function createServerRouter<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
>(
  options: ServerRouterOptions<TLocals, TPlatform, TServices>,
): ServerRouter<TLocals, TPlatform, TServices> {
  const liveHeartbeatInterval = resolveLiveHeartbeatInterval(options.liveHeartbeatInterval);
  const routesByMethod = new Map<
    string,
    PreparedRoute<TLocals, TPlatform, TServices>[]
  >();
  const routesById = new Map<
    string,
    PreparedRoute<TLocals, TPlatform, TServices>
  >();
  const livePaths=new Set<string>();
  const liveSessions=createLiveSessions(path=>livePaths.has(path),(request,platform)=>dispatch(request,
    platform===undefined?{}:{platform:platform as TPlatform}),liveHeartbeatInterval);

  for (let routeIndex = 0; routeIndex < options.routes.length; routeIndex++) {
    const declared = options.routes[routeIndex]!;
    const path = validateRoutePattern(declared.path);
    if(path===LIVE_SESSION_PATH)throw new TypeError(`Route '${path}' uses the reserved live transport namespace`);
    const internal = declared as InternalServerFunctionRoute<
      TLocals,
      TPlatform,
      TServices
    >;
    if(internal.__memoizedLive===true)livePaths.add(path);
    if (
      (path === '/_fn' || path.startsWith('/_fn/')) &&
      internal[SERVER_FUNCTION_ROUTE_KEY] !== true
    ) {
      throw new TypeError(
        `Route '${path}' uses the reserved server-function namespace '/_fn/*'`,
      );
    }
    const routeMethods = methodsFor(declared);
    for (const method of routeMethods) {
      const id = `${routeIndex}:${method}:${declared.id ?? path}`;
      const route: PreparedRoute<TLocals, TPlatform, TServices> = Object.freeze({
        id,
        method,
        path,
        middleware: Object.freeze([...(declared.middleware ?? [])]),
        handler: declared.handler,
      });
      let methodRoutes = routesByMethod.get(method);
      if (methodRoutes === undefined) {
        methodRoutes = [];
        routesByMethod.set(method, methodRoutes);
      }
      methodRoutes.push(route);
      routesById.set(id, route);
    }
  }

  const staticRoutes = new Map<
    string,
    Map<string, PreparedRoute<TLocals, TPlatform, TServices>>
  >();
  const dynamicMatchers = new Map<string, RouteTableMatcher>();
  for (const [method, routes] of routesByMethod) {
    const definitions = routes.map(route => ({
      id: route.id,
      pattern: route.path,
    }));
    try {
      validateRoutePatterns(definitions);
    } catch (error) {
      throw new TypeError(`Invalid ${method} route table`, { cause: error });
    }
    const staticMethodRoutes = new Map<
      string,
      PreparedRoute<TLocals, TPlatform, TServices>
    >();
    const dynamicDefinitions: typeof definitions = [];
    for (let index = 0; index < routes.length; index++) {
      const route = routes[index]!;
      if (route.path.includes(':') || route.path.includes('*')) {
        dynamicDefinitions.push(definitions[index]!);
      } else {
        staticMethodRoutes.set(route.path, route);
      }
    }
    if (staticMethodRoutes.size > 0) staticRoutes.set(method, staticMethodRoutes);
    if (dynamicDefinitions.length > 0) {
      dynamicMatchers.set(method, createRouteMatcher(dynamicDefinitions));
    }
  }

  const groups: readonly PreparedGroup<TLocals, TPlatform, TServices>[] = Object.freeze(
    (options.groups ?? [])
      .map((group, order) => {
        const path = validateRoutePattern(group.path);
        return Object.freeze({
          path,
          depth: path === '/' ? 0 : path.split('/').length - 1,
          order,
          middleware: Object.freeze([...group.middleware]),
        });
      })
      .sort((left, right) => left.depth - right.depth || left.order - right.order),
  );
  const globalMiddleware = Object.freeze([...(options.middleware ?? [])]);

  function matchMethod(
    pathname: string,
    method: string,
  ): MethodMatch<TLocals, TPlatform, TServices> | null {
    const staticRoute = staticRoutes.get(method)?.get(pathname);
    if (staticRoute !== undefined) {
      return { route: staticRoute, params: EMPTY_PARAMS };
    }
    const dynamic = dynamicMatchers.get(method)?.match(pathname) ?? null;
    return dynamic === null
      ? null
      : { route: routesById.get(dynamic.id)!, params: dynamic.params };
  }

  function select(
    pathname: string,
    method: string,
  ): RouteSelection<TLocals, TPlatform, TServices> | null {
    const normalizedMethod = normalizeMethod(method);
    const direct = matchMethod(pathname, normalizedMethod);
    if (direct !== null) {
      return {
        route: direct.route,
        params: direct.params,
      };
    }
    if (normalizedMethod !== 'HEAD') return null;
    const get = matchMethod(pathname, 'GET');
    return get === null
      ? null
      : {
          route: get.route,
          params: get.params,
        };
  }

  function allowedMethods(pathname: string): readonly string[] {
    const allowed = new Set<string>();
    for (const method of routesByMethod.keys()) {
      if (matchMethod(pathname, method) === null) continue;
      allowed.add(method);
      if (method === 'GET') allowed.add('HEAD');
    }
    if (allowed.size > 0) allowed.add('OPTIONS');
    return Object.freeze([...allowed].sort(sortMethods));
  }

  function matchingGroups(
    pathname: string,
  ): {
    readonly middleware: readonly ServerMiddleware<TLocals, TPlatform, TServices>[];
    readonly params: Readonly<Record<string, string>>;
  } {
    if (groups.length === 0) {
      return { middleware: globalMiddleware, params: EMPTY_PARAMS };
    }
    const middleware = [...globalMiddleware];
    const params: Record<string, string> = {};
    for (const group of groups) {
      const match = matchRoutePattern(group.path, pathname, { end: false });
      if (match === null) continue;
      middleware.push(...group.middleware);
      for (const [name, value] of Object.entries(match.params)) {
        if (name !== '*') params[name] = value;
      }
    }
    return {
      middleware,
      params: Object.keys(params).length === 0
        ? EMPTY_PARAMS
        : Object.freeze(params),
    };
  }

  async function dispatch(
    request: Request,
    dispatchOptions: ServerDispatchOptions<TLocals, TPlatform, TServices> = {},
  ): Promise<Response> {
    if(new URL(request.url).pathname===LIVE_SESSION_PATH)return liveSessions.handle(request,dispatchOptions.platform);
    const url = new URL(request.url);
    const pathname = normalizeRoutePath(url.pathname);
    const method = normalizeMethod(request.method);
    const selection = select(pathname, method);
    const allowed = selection === null ? allowedMethods(pathname) : [];
    const groupMatch = matchingGroups(pathname);
    const params = selection === null
      ? groupMatch.params
      : Object.freeze({ ...groupMatch.params, ...selection.params });
    const state = dispatchOptions.state ?? options.createState?.(request) ??
      (Object.create(null) as TLocals);
    const platform = dispatchOptions.platform ?? options.createPlatform?.(request);
    const services = dispatchOptions.services ?? options.services ??
      (Object.create(null) as TServices);
    const context: ServerContext<TLocals, TPlatform, TServices> = Object.freeze(Object.defineProperty({
      request,
      url,
      params,
      state,
      platform,
      services,
    }, LIVE_HEARTBEAT_INTERVAL, {value: liveHeartbeatInterval}));
    streamErrorReporters.set(context, async error => {
      // Headers/status are already committed: use onError for server-side
      // observation, discard its replacement response and release its body.
      if (options.onError === undefined) { reportUnhandledError(request, error); return; }
      const response = await options.onError(error, context);
      await response.body?.cancel();
    });

    let terminal: (
      value: ServerContext<TLocals, TPlatform, TServices>,
    ) => Promise<Response>;
    let middleware = groupMatch.middleware;
    if (selection !== null) {
      middleware = [...middleware, ...selection.route.middleware];
      terminal = async value => {
        return normalizeHandlerResult(
          await selection.route.handler(value),
        );
      };
    } else if (method === 'OPTIONS' && allowed.length > 0) {
      terminal = async () => new Response(null, {
        status: 204,
        headers: { allow: allowed.join(', ') },
      });
    } else if (allowed.length > 0) {
      terminal = async () => new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: allowed.join(', ') },
      });
    } else if (options.fallback !== undefined) {
      terminal = async value => normalizeHandlerResult(await options.fallback!(value));
    } else {
      terminal = async () => new Response('Not Found', { status: 404 });
    }

    try {
      const response = await runMiddleware(middleware, terminal, context);
      return method === 'HEAD' ? withoutBody(response) : response;
    } catch (error) {
      if (options.onError === undefined) reportUnhandledError(request, error);
      const response = options.onError === undefined
        ? new Response('Internal Server Error', { status: 500 })
        : await options.onError(error, context);
      return method === 'HEAD' ? withoutBody(response) : response;
    }
  }

  return Object.freeze({
    fetch: (request: Request) => dispatch(request),
    dispatch,
    matches(pathname: string, method: string) {
      return select(normalizeRoutePath(pathname), method) !== null;
    },
    allowedMethods(pathname: string) {
      return allowedMethods(normalizeRoutePath(pathname));
    },
  });
}
