/**
 * Server functions as ordinary router routes. Each definition the compiler discovered becomes a
 * route under `/_fn/`: its arguments are decoded (`server-function-arguments.ts`), and its value
 * is answered in the way the request asks (`x-mmd-stream`): a live subscription, a generator
 * stream, a snapshot that stays consistent with its live key, or a plain response with the keys a
 * mutation changed (`x-mmd-updates`). A WebSocket function prepares its room instead.
 */
import { generatorResponse, liveHub, liveQueryRejection, liveResponse, type LiveStamp } from './live';
import { captureLiveResponse, createLiveSubscription } from './live-session';
import { LIVE_HEARTBEAT_INTERVAL } from './live-heartbeat';
import { socketUpgrade } from './websocket/upgrade';
import {
  bodyArguments,
  bodySchemaInput,
  queryArguments,
  querySchemaInput,
  serverFunctionError,
  ServerFunctionInputError,
  socketArguments,
  validateServerFunctionArguments,
} from './server-function-arguments';
import {
  discardServerFunctionValue,
  normalizeHandlerResult,
  serverFunctionValue,
  SERVER_FUNCTION_ROUTE_KEY,
  streamErrorReporters,
  type InternalServerFunctionRoute,
} from './handler-results';
import type {
  RegisteredServerPlatform,
  RegisteredServerServices,
  RegisteredServerState,
  ServerFunctionRouteDefinition,
  ServerRoute,
  ServerSocketRouteDefinition,
} from './http-router';

/** Convert discovered named HTTP functions into ordinary router definitions. */
export function createServerFunctionRoutes<
  TLocals extends object = RegisteredServerState,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
>(
  definitions: readonly (
    ServerFunctionRouteDefinition<TLocals, TPlatform, TServices>
    | ServerSocketRouteDefinition<TLocals, TPlatform, TServices>
  )[],
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
    if (definition.method === 'WEBSOCKET') {
      const route: InternalServerFunctionRoute<TLocals, TPlatform, TServices> = {
        [SERVER_FUNCTION_ROUTE_KEY]: true,
        id: definition.id,
        path: definition.path,
        method: 'GET',
        middleware: definition.middleware,
        async handler(context) {
          const capture = socketUpgrade(context.request);
          if (capture === undefined) {
            return new Response('WebSocket upgrade required', { status: 426, headers: { upgrade: 'websocket' } });
          }

          let args: unknown[] | Response;
          try {
            args = definition.schemaInput
              ? await validateServerFunctionArguments(definition.input!, querySchemaInput(context.url))
              : socketArguments(context.url, definition.parameters);
          } catch (error) {
            if (error instanceof ServerFunctionInputError) return serverFunctionError(error);
            throw error;
          }
          if (args instanceof Response) return args;

          const session = await definition.handler(context, ...args);
          if (session instanceof Response) return session;
          if (typeof session?.message !== 'function') {
            throw new TypeError(`WebSocket function '${definition.id}' must return a message handler`);
          }

          // Endpoints can have different message types even when using the same key.
          const key = liveHub(context.services).key(definition.live(context, ...args));
          capture.prepared = { room: JSON.stringify([definition.id, key]), session };
          return new Response(null, { status: 204 });
        },
      };
      return route;
    }
    const route: InternalServerFunctionRoute<TLocals, TPlatform, TServices> = {
      [SERVER_FUNCTION_ROUTE_KEY]: true,
      __memoizedLive: definition.method === 'GET' && definition.live !== undefined,
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
            const query = async (signal: AbortSignal) => {
              const request = new Request(context.url, { method: context.request.method, headers: context.request.headers, signal });
              const liveContext = { ...context, request };
              const result = await serverFunctionValue(await definition.handler(liveContext, ...args), liveContext, context);
              if (result instanceof Response) {
                if (!result.ok) throw await liveQueryRejection(result);
                return result.headers.get('content-type')?.includes('json') ? result.json() : result.text();
              }
              return result;
            };
            const report = streamErrorReporters.get(context);
            // On the shared stream, the session takes the subscription; otherwise this request
            // becomes its own live stream.
            const shared = captureLiveResponse(context.request, (run) => createLiveSubscription(
              hub, hub.key(key), context.request, (signal) => run(() => query(signal), signal), report, definition.refresh,
            ));
            return shared ?? liveResponse(
              hub, hub.key(key), context.request, query, report,
              Reflect.get(context, LIVE_HEARTBEAT_INTERVAL) as number | undefined, definition.refresh,
            );
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
