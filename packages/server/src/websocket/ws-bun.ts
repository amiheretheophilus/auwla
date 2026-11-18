import { matchesSocket } from './host';
import { createSocketRooms, MAX_MESSAGE_BYTES, type Connection, type RoomDelivery } from './room';
import { discardPreparedSocket, prepareSocket, type PreparedSocket } from './upgrade';

type NativeServer = Bun.Server<BunSocketData>;
type NativeSocket = Bun.ServerWebSocket<BunSocketData>;

interface BunSocketData {
  readonly listener: NativeServer;
  readonly owner: SocketOwner;
  prepared?: PreparedSocket;
  connection?: Connection<NativeSocket>;
}

interface SocketOwner {
  readonly rooms: ReturnType<typeof createSocketRooms<NativeSocket>>;
  readonly sockets: Set<NativeSocket>;
}

interface Application {
  fetch(request: Request, options?: DispatchOptions): Promise<Response>;
}

interface DispatchOptions {
  platform?: unknown;
}

interface BunSocketApplication {
  fetch(request: Request, options?: NativeServer | DispatchOptions): Promise<Response | undefined>;
  readonly websocket: Bun.WebSocketHandler<BunSocketData>;
  closeSockets(): Promise<void>;
}

function isNativeServer(platform: unknown): platform is NativeServer {
  return typeof platform === 'object' && platform !== null
    && typeof Reflect.get(platform, 'upgrade') === 'function';
}

function bunRoomDelivery(topic: string, sockets: ReadonlySet<NativeSocket>): RoomDelivery<NativeSocket> {
  // One application can serve a room through several native listeners. Bun's
  // topic registry belongs to each listener, so publish once through each one.
  const listeners = new Map<NativeServer, number>();
  return {
    join(socket) {
      const { listener } = socket.data;
      socket.subscribe(topic);
      listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
    },
    leave(socket) {
      const { listener } = socket.data;
      socket.unsubscribe(topic);
      const remaining = listeners.get(listener)! - 1;
      if (remaining === 0) listeners.delete(listener);
      else listeners.set(listener, remaining);
    },
    send(socket, text) {
      if (socket.send(text) === 0) socket.terminate();
    },
    publish(text) {
      for (const listener of listeners.keys()) {
        if (listener.publish(topic, text, false) === 0) disconnectSlowPeers(listener);
      }
    },
  };

  function disconnectSlowPeers(listener: NativeServer): void {
    // Bun can leave a subscriber open after dropping a frame. Restore its
    // baseline on reconnect. Only walk sockets when native delivery drops data.
    for (const socket of sockets) {
      if (socket.data.listener === listener && socket.isSubscribed(topic)
        && socket.getBufferedAmount() > MAX_MESSAGE_BYTES) {
        socket.terminate();
      }
    }
  }
}

// A reloaded listener can receive events for the previous application's
// sockets. Use their saved owner for delivery and teardown.
const websocket: Bun.WebSocketHandler<BunSocketData> = {
  idleTimeout: 120,
  sendPings: true,
  maxPayloadLength: MAX_MESSAGE_BYTES,
  backpressureLimit: MAX_MESSAGE_BYTES,
  closeOnBackpressureLimit: true,
  open(socket) {
    const data = socket.data;
    const prepared = data.prepared!;
    data.prepared = undefined;
    data.owner.sockets.add(socket);
    data.connection = data.owner.rooms.open(prepared, socket);
  },
  message(socket, message) {
    const { owner, connection } = socket.data;
    if (connection === undefined) return;

    if (typeof message === 'string') owner.rooms.message(connection, message);
    else socket.close(1003, 'WebSocket messages must be JSON text');
  },
  close(socket) {
    const data = socket.data;
    data.owner.sockets.delete(socket);
    if (data.connection !== undefined) {
      data.owner.rooms.close(data.connection);
      data.connection = undefined;
    }
  },
};

/** Keep Bun's native listener options on the generated serve() application. */
export function attachBunSockets<T extends Application>(application: T, endpoints: readonly string[]): Omit<T, 'fetch'> & BunSocketApplication {
  const dispatch = application.fetch.bind(application);
  const paths = new Set(endpoints);
  const topicPrefix = `memoized:${crypto.randomUUID()}:`;
  let nextTopic = 0;
  const sockets = new Set<NativeSocket>();
  const owner: SocketOwner = {
    rooms: createSocketRooms<NativeSocket>(() => bunRoomDelivery(`${topicPrefix}${++nextTopic}`, sockets)),
    sockets,
  };
  let generation = 0;

  async function fetch(request: Request, options?: NativeServer | DispatchOptions): Promise<Response | undefined> {
    const dispatchOptions = isNativeServer(options) ? { platform: options } : options;
    const platform = dispatchOptions?.platform;
    if (!matchesSocket(request, paths) || !isNativeServer(platform)) {
      return dispatch(request, dispatchOptions);
    }

    const openingGeneration = generation;
    let prepared: PreparedSocket | undefined;
    try {
      const upgrade = await prepareSocket(request, incoming => dispatch(incoming, dispatchOptions));
      prepared = upgrade.prepared;
      if (openingGeneration === generation && platform.upgrade(request, {
        headers: upgrade.headers,
        data: { owner, listener: platform, prepared } satisfies BunSocketData,
      })) {
        return undefined;
      }
    } catch (error) {
      if (error instanceof Response) return error;
      console.error('[memo-dom] WebSocket upgrade failed', error);
    }

    await discardPreparedSocket(prepared);
    return new Response('WebSocket upgrade failed', { status: openingGeneration === generation ? 500 : 503 });
  }

  async function closeSockets(): Promise<void> {
    generation++;
    for (const socket of owner.sockets) socket.close(1012, 'Server reloaded');
  }

  return Object.assign(application, { fetch, websocket, closeSockets });
}
