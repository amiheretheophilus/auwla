import type { Hooks, Peer } from 'crossws';
import { createSocketRooms, type Connection } from './room';
import { discardPreparedSocket, prepareSocket, type PreparedSocket } from './upgrade';

export type SocketDispatch<Platform = unknown> = (request: Request, platform?: Platform) => Promise<Response>;

interface SocketContext {
  prepared: PreparedSocket | undefined;
  rooms: ReturnType<typeof createSocketRooms<Peer>>;
  connection?: Connection<Peer>;
}

function socketContext(peer: Peer): SocketContext {
  return peer.context as unknown as SocketContext;
}

export function socketHost<Platform>(dispatch: SocketDispatch<Platform>) {
  const rooms = createSocketRooms<Peer>();
  const platforms = new WeakMap<Request, Platform>();
  let generation = 0;
  const hooks: Partial<Hooks> = {
    async upgrade(request) {
      const platform = platforms.get(request);
      platforms.delete(request);
      const openingGeneration = generation;
      const { prepared, headers } = await prepareSocket(request, incoming => dispatch(incoming, platform));
      if (openingGeneration !== generation) {
        await discardPreparedSocket(prepared);
        throw new Response('WebSocket upgrade interrupted by a reload', { status: 503 });
      }

      return { context: { prepared, rooms } satisfies SocketContext, headers };
    },
    open(peer) {
      const context = socketContext(peer);
      const prepared = context.prepared;
      if (prepared === undefined) return;

      context.prepared = undefined;
      context.connection = context.rooms.open(prepared, peer);
    },
    message(peer, message) {
      const { connection, rooms } = socketContext(peer);
      if (connection !== undefined) {
        if (typeof message.rawData === 'string') rooms.message(connection, message.rawData);
        else peer.close(1003, 'WebSocket messages must be JSON text');
      }
    },
    close(peer) {
      const context = socketContext(peer);
      if (context.connection !== undefined) {
        context.rooms.close(context.connection);
        context.connection = undefined;
      }
    },
    error(peer, error) {
      console.error('[memo-dom] WebSocket transport failed', error);
      const { connection, rooms } = socketContext(peer);
      if (connection !== undefined) {
        rooms.close(connection);
      }
    },
  };
  return {
    hooks,
    platform(request: Request, platform: Platform): void {
      platforms.set(request, platform);
    },
    invalidateUpgrades(): void {
      generation++;
    },
  };
}

export function matchesSocket(request: Request, paths: ReadonlySet<string>): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket'
    && paths.has(new URL(request.url).pathname);
}
