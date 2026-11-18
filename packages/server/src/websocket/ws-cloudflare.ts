import { matchesSocket, type SocketDispatch } from './host';
import { createSocketRooms } from './room';
import { prepareSocket } from './upgrade';

export { matchesSocket as matchesCloudflareSocket } from './host';

interface DurableNamespace {
  getByName(name: string): { fetch(request: Request): Promise<Response> };
}

export function forwardCloudflareSocket(request: Request, env: unknown, binding: string): Promise<Response> {
  const namespace = (env as Record<string, DurableNamespace> | undefined)?.[binding];
  if (namespace === undefined) {
    return Promise.resolve(new Response(`Missing WebSocket Durable Object binding '${binding}'`, { status: 503 }));
  }
  return namespace.getByName('application').fetch(request);
}

interface WorkerSocket extends WebSocket {
  accept(): void;
}

type SocketPair = new () => { 0: WebSocket; 1: WorkerSocket };

interface Platform {
  readonly env: unknown;
  readonly executionCtx: unknown;
}

/** A Durable Object keeps room peers together across Worker isolates. Its sockets
 * stay awake because handler sessions can close over their server context. */
export function cloudflareSocketHost(
  dispatch: SocketDispatch,
  endpoints: readonly string[],
): new (state: unknown, env: unknown) => { fetch(request: Request): Promise<Response> } {
  const paths = new Set(endpoints);
  return class MemoizedWebSocketHost {
    readonly #rooms = createSocketRooms();
    readonly #platform: Platform;

    constructor(state: unknown, env: unknown) {
      this.#platform = { env, executionCtx: state };
    }

    async fetch(request: Request): Promise<Response> {
      if (!matchesSocket(request, paths)) return new Response('Not Found', { status: 404 });

      try {
        const { prepared, headers } = await prepareSocket(request, incoming => dispatch(incoming, this.#platform));
        const Pair = Reflect.get(globalThis, 'WebSocketPair') as SocketPair;
        const pair = new Pair();
        const server = pair[1];
        server.accept();

        const connection = this.#rooms.open(prepared, server);
        server.addEventListener('message', event => {
          if (typeof event.data === 'string') this.#rooms.message(connection, event.data);
          else server.close(1003, 'WebSocket messages must be JSON text');
        });
        server.addEventListener('close', () => this.#rooms.close(connection));
        server.addEventListener('error', () => {
          this.#rooms.close(connection);
          server.close(1011, 'WebSocket transport failed');
        });

        const response: ResponseInit & { webSocket: WebSocket } = { status: 101, webSocket: pair[0], headers };
        return new Response(null, response);
      } catch (error) {
        if (error instanceof Response) return error;
        console.error('[memo-dom] WebSocket upgrade failed', error);
        return new Response('WebSocket upgrade failed', { status: 500 });
      }
    }
  };
}
