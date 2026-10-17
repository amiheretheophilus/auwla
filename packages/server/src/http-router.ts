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
import { generatorResponse, liveHub, liveResponse, type LiveKey, type LiveStamp } from './live';
import { isServerPage } from './page-definition';
import { captureLiveResponse, createLiveSessions, createLiveSubscription, LIVE_SESSION_PATH } from './live-session';
import { LIVE_HEARTBEAT_INTERVAL, resolveLiveHeartbeatInterval } from './live-heartbeat';

const pageFetches = new WeakMap<object, typeof globalThis.fetch>();
/** @internal Same request dispatch capability already used by document SSR. */
export function installServerPageFetch(context: object, fetch: typeof globalThis.fetch): void { pageFetches.set(context, fetch); }

async function serverFunctionValue(value: unknown, context: ServerContext<object, unknown, object>, fetchContext: object = context, html = false): Promise<unknown> {
  if (!isServerPage(value)) return value;
  const { renderServerPage, serverPageResponse, serverPageUpdates, serverPageStreamResponse } = await import('./page');
  const options = {
    url: context.url.href, signal: context.request.signal, routedContext: context,
    ...(pageFetches.has(fetchContext) ? { fetch: pageFetches.get(fetchContext)! } : {}),
  };
  if (context.request.headers.get('x-mmd-page-stream') === '1' && context.request.headers.get('x-mmd-stream') !== 'snapshot') {
    const updates = serverPageUpdates(value, options);
    return html ? serverPageStreamResponse(updates, context.request, streamErrorReporters.get(fetchContext)) : updates;
  }
  const rendered = await renderServerPage(value, options);
  return html ? serverPageResponse(rendered) : rendered;
}

/** A consistency retry owns its discarded body/iterator, not the eventual caller. */
async function discardServerFunctionValue(value: unknown): Promise<void> {
  if (value instanceof Response) await value.body?.cancel();
  else if (value !== null && typeof value === 'object' && Symbol.asyncIterator in value) {
    const iterator = (value as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    await iterator.return?.();
  }
}

// Keep reporting request-scoped without adding public context fields or retaining
// completed requests. Live bodies execute after the dispatch try/catch returns.
const streamErrorReporters = new WeakMap<object, (error: unknown) => Promise<void>>();

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
  readonly handler: (
    context: ServerContext<TLocals, TPlatform, TServices>,
    ...args: unknown[]
  ) => ServerHandlerResult | Promise<ServerHandlerResult>;
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
/**
 * String-keyed brand: route objects cross module instances (dev-server vs
 * host), where a Symbol identity would not match.
 */
const SERVER_FUNCTION_ROUTE_KEY = '__memoDomServerFunctionRoute';

type InternalServerFunctionRoute<TLocals extends object, TPlatform, TServices extends object> =
  ServerRoute<TLocals, TPlatform, TServices> & {
    readonly [SERVER_FUNCTION_ROUTE_KEY]?: true;
    readonly __memoizedLive?: boolean;
  };

class ServerFunctionInputError extends Error {}

function serverFunctionInputError(message: string): never {
  throw new ServerFunctionInputError(message);
}

function scalarQueryValue(
  name: string,
  value: string,
  kind: 'string' | 'number' | 'boolean',
): string | number | boolean {
  if (kind === 'string') return value;
  if (kind === 'number') {
    const number = Number(value);
    if (value.trim() === '' || !Number.isFinite(number)) {
      return serverFunctionInputError(
        `Query parameter '${name}' must be a finite number`,
      );
    }
    return number;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return serverFunctionInputError(
    `Query parameter '${name}' must be 'true' or 'false'`,
  );
}

function queryArguments(
  url: URL,
  parameters: readonly ServerFunctionRouteParameter[],
): unknown[] {
  const known = new Set(parameters.map(parameter => parameter.name));
  for (const name of url.searchParams.keys()) {
    if (!known.has(name)) {
      serverFunctionInputError(`Unknown query parameter '${name}'`);
    }
  }
  return parameters.map((parameter) => {
    const kind = parameter.queryKind ?? 'string';
    const values = url.searchParams.getAll(parameter.name);
    if (values.length === 0) {
      if (parameter.optional) return undefined;
      return serverFunctionInputError(
        `Missing query parameter '${parameter.name}'`,
      );
    }
    if (kind.endsWith('[]')) {
      const scalarKind = kind.slice(0, -2) as 'string' | 'number' | 'boolean';
      return values.map(value =>
        scalarQueryValue(parameter.name, value, scalarKind));
    }
    if (values.length !== 1) {
      return serverFunctionInputError(
        `Query parameter '${parameter.name}' must appear once`,
      );
    }
    return scalarQueryValue(
      parameter.name,
      values[0]!,
      kind as 'string' | 'number' | 'boolean',
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function bodyArguments(
  request: Request,
  parameters: readonly ServerFunctionRouteParameter[],
): Promise<unknown[]> {
  if (parameters.length === 0 && request.body === null) return [];
  let body: unknown;
  try {
    const text = await request.text();
    if (parameters.length === 0 && text.trim() === '') return [];
    body = JSON.parse(text);
  } catch {
    return serverFunctionInputError('Request body must be valid JSON');
  }
  if (!isRecord(body)) {
    return serverFunctionInputError('Request body must be a JSON object');
  }
  const known = new Set(parameters.map(parameter => parameter.name));
  for (const name of Object.keys(body)) {
    if (!known.has(name)) {
      serverFunctionInputError(`Unknown request body field '${name}'`);
    }
  }
  return parameters.map((parameter) => {
    if (!Object.hasOwn(body, parameter.name)) {
      if (parameter.optional) return undefined;
      return serverFunctionInputError(
        `Missing request body field '${parameter.name}'`,
      );
    }
    return body[parameter.name];
  });
}

async function validateServerFunctionArguments(
  schema: StandardSchemaV1,
  input: unknown,
): Promise<unknown[] | Response> {
  const result = await schema['~standard'].validate(input);
  if (result.issues !== undefined) {
    return Response.json({
      error: 'invalid_server_function_input',
      message: 'Input validation failed',
      issues: result.issues,
    }, { status: 400 });
  }
  return [result.value];
}

function querySchemaInput(url: URL): unknown {
  for (const name of url.searchParams.keys()) {
    if (name !== 'input') serverFunctionInputError(`Unknown query parameter '${name}'`);
  }
  const values = url.searchParams.getAll('input');
  if (values.length !== 1) {
    return serverFunctionInputError("Validated GET input must appear once as query parameter 'input'");
  }
  try {
    return JSON.parse(values[0]!);
  } catch {
    return serverFunctionInputError('Validated GET input must be valid JSON');
  }
}

async function bodySchemaInput(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return serverFunctionInputError('Request body must be valid JSON');
  }
}

function serverFunctionError(error: ServerFunctionInputError): Response {
  return Response.json({
    error: 'invalid_server_function_input',
    message: error.message,
  }, { status: 400 });
}

/** Convert discovered named HTTP functions into ordinary router definitions. */
export function createServerFunctionRoutes<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
>(
  definitions: readonly ServerFunctionRouteDefinition<TLocals, TPlatform, TServices>[],
): readonly ServerRoute<TLocals, TPlatform, TServices>[] {
  return definitions.map((definition) => {
    if (!definition.path.startsWith('/_fn/')) {
      throw new TypeError(
        `Server function '${definition.id}' must use the reserved /_fn/ namespace`,
      );
    }
    if (definition.middleware?.some(middleware => typeof middleware !== 'function')) {
      throw new TypeError(`Server function '${definition.id}' middleware must contain functions`);
    }
    if (definition.input !== undefined && (
      definition.input?.['~standard']?.version !== 1 ||
      typeof definition.input?.['~standard']?.validate !== 'function'
    )) {
      throw new TypeError(`Server function '${definition.id}' input must implement Standard Schema v1`);
    }
    if (definition.schemaInput === true && definition.input === undefined) {
      throw new TypeError(`Server function '${definition.id}' schema input requires an input validator`);
    }
    if (definition.input !== undefined && definition.schemaInput !== true) {
      throw new TypeError(`Server function '${definition.id}' input validator requires schema input transport`);
    }
    const route: InternalServerFunctionRoute<TLocals, TPlatform, TServices> = {
      [SERVER_FUNCTION_ROUTE_KEY]: true,
      __memoizedLive: definition.method==='GET'&&definition.live!==undefined,
      id: definition.id,
      method: definition.method,
      path: definition.path,
      middleware: definition.middleware,
      async handler(context) {
        try {
          let args: unknown[];
          if (definition.schemaInput === true) {
            const input = definition.method === 'GET'
              ? querySchemaInput(context.url)
              : await bodySchemaInput(context.request);
            const validated = await validateServerFunctionArguments(definition.input!, input);
            if (validated instanceof Response) return validated;
            args = validated;
          } else {
            args = definition.method === 'GET'
              ? queryArguments(context.url, definition.parameters)
              : await bodyArguments(context.request, definition.parameters);
          }
          const hub = liveHub(context.services);
          const key = definition.live?.(context, ...args);
          const update = () => definition.updates === undefined ? [] : [hub.invalidate(definition.updates(context, ...args))];
          const mode = context.request.headers.get('x-mmd-stream');
          if (key !== undefined && mode === 'live') {
            const query=async (signal:AbortSignal) => {
              const request = new Request(context.url, { method: context.request.method, headers: context.request.headers, signal });
              const liveContext = { ...context, request };
              const result = await serverFunctionValue(await definition.handler(liveContext, ...args), liveContext, context);
              if (result instanceof Response) {
                if (!result.ok) { await result.body?.cancel(); throw new Error('Live query rejected'); }
                return result.headers.get('content-type')?.includes('json') ? result.json() : result.text();
              }
              return result;
            };
            const report=streamErrorReporters.get(context);
            return captureLiveResponse(context.request,run=>createLiveSubscription(hub,hub.key(key),context.request,
              signal=>run(()=>query(signal),signal),report))??liveResponse(hub,hub.key(key),context.request,query,report,
                Reflect.get(context,LIVE_HEARTBEAT_INTERVAL) as number|undefined);
          }
          let cancellation = new AbortController();
          let value: unknown;
          let snapshotStamp: LiveStamp | undefined;
          // Snapshot reads need the same key-local cursor tracking as SSE reads.
          // Otherwise an unsubscribed key follows the global revision and retries
          // whenever an unrelated query family changes.
          const snapshotKey = key === undefined ? undefined : hub.key(key);
          const releaseSnapshot = snapshotKey === undefined ? undefined : hub.subscribe(snapshotKey, () => {});
          // A handler may ignore its signal or finish much later than the client.
          if (releaseSnapshot) context.request.signal.addEventListener('abort', releaseSnapshot, { once: true });
          try {
            for (;;) {
              context.request.signal.throwIfAborted();
              snapshotStamp = snapshotKey === undefined ? undefined : hub.stamp(snapshotKey);
              const attemptContext = mode === 'generator' || mode === 'snapshot' || snapshotKey !== undefined
                ? { ...context, request: new Request(context.url, { method: context.request.method, headers: context.request.headers, signal: AbortSignal.any([context.request.signal, cancellation.signal]) }) }
                : context;
              value = await definition.handler(attemptContext, ...args);
              value = await serverFunctionValue(value, attemptContext, context, true);
              context.request.signal.throwIfAborted();
              if (snapshotStamp === undefined || snapshotStamp.revision === hub.stamp(snapshotStamp.key).revision) break;
              cancellation.abort();
              const discarded = value;
              value = undefined;
              await discardServerFunctionValue(discarded);
              cancellation = new AbortController();
            }
          } catch (error) {
            cancellation.abort();
            // Preserve the original handler/render failure if cleanup also fails.
            await discardServerFunctionValue(value).catch(() => {});
            throw error;
          } finally {
            if (releaseSnapshot) context.request.signal.removeEventListener('abort', releaseSnapshot);
            releaseSnapshot?.();
          }
          if (value !== null && typeof value === 'object' && Symbol.asyncIterator in value) {
            const iterator = (value as AsyncIterable<unknown>)[Symbol.asyncIterator]();
            if (mode === 'generator') {
              return generatorResponse(context.request, iterator, () => cancellation.abort(), update, streamErrorReporters.get(context));
            }
            // SSR/read preparation only consumes one yield. POST streams must
            // execute through their generated streaming client, never as snapshots.
            if (definition.method !== 'GET') {
              cancellation.abort();
              void iterator.return?.().catch(() => {});
              return new Response('Mutation streams require their streaming client', { status: 400 });
            }
            try {
              const first = await iterator.next();
              if (first.done) throw new Error('Streaming functions must yield an initial value');
              return first.value;
            } finally {
              cancellation.abort();
              void iterator.return?.().catch(() => {});
            }
          }
          const response = normalizeHandlerResult(value);
          if (!response.ok) return response;
          const stamps = update();
          if (stamps.length === 0 && snapshotStamp === undefined) return response;
          const headers = new Headers(response.headers);
          if (stamps.length > 0) headers.set('x-mmd-updates', JSON.stringify(stamps));
          if (snapshotStamp !== undefined) headers.set('x-mmd-live', JSON.stringify(snapshotStamp));
          return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        } catch (error) {
          if (error instanceof ServerFunctionInputError) {
            return serverFunctionError(error);
          }
          throw error;
        }
      },
    };
    return Object.freeze(route);
  });
}

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

function textResponse(value: string): Response {
  return new Response(value, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function normalizeHandlerResult(value: unknown): Response {
  if (value instanceof Response) return value;
  if (value === undefined) return new Response(null, { status: 204 });
  if (typeof value === 'string') return textResponse(value);
  if (value instanceof ReadableStream) return new Response(value);
  return Response.json(value);
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
    if (options.onError !== undefined) {
      streamErrorReporters.set(context, async error => {
        // Headers/status are already committed: use onError for server-side
        // observation, discard its replacement response and release its body.
        const response = await options.onError!(error, context);
        await response.body?.cancel();
      });
    }

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
