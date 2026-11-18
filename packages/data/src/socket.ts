import {
  getActiveApplicationRuntime,
  getActiveEnvironment,
  publishVersions,
  runWithApplicationRuntime,
  trackRead,
} from '@memoized-dom/runtime';

export interface SocketTracker {
  readonly status: 'connecting' | 'open' | 'closed' | 'error';
  readonly error: Error | null;
}

export interface SocketConnection<Input, Event, Result, Initial = Event> {
  /** The first room read. Reconnects deliver a fresh read through onMessage. */
  readonly ready: Promise<Initial>;
  send(value: Input): Promise<Result>;
  onMessage(listener: (value: Event) => void): () => void;
  close(): void;
}

interface PendingMessage {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

type ServerFrame =
  | { type: 'ready'; value?: unknown }
  | { type: 'message'; value: unknown }
  | { type: 'result'; id: number; value?: unknown }
  | { type: 'error'; id: number; message: string };

const trackers = new WeakMap<object, () => SocketTracker>();
const MAX_PENDING = 64;
const MAX_RETRIES = 5;

export function trackSocketConnection(value: unknown): SocketTracker | undefined {
  if (typeof value === 'object' && value !== null) return trackers.get(value)?.();
  return undefined;
}

/** Used by generated client facades. A socket belongs to the caller until close(). */
export function createSocketConnection(path: string, query: Record<string, string | undefined>): SocketConnection<unknown, unknown, unknown> {
  const runtime = getActiveApplicationRuntime();
  const key = {};
  const listeners = new Set<(value: unknown) => void>();
  const pending = new Map<number, PendingMessage>();
  let version = 0;
  const readVersion = () => version;
  let snapshot: SocketTracker = { status: 'connecting', error: null };
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let nextId = 0;
  let ended = false;
  let opened = false;
  const ready = Promise.withResolvers<unknown>();
  // Callers can use onMessage and $track without awaiting ready.
  void ready.promise.catch(() => {});

  function state(status: SocketTracker['status'], error: Error | null = null): void {
    snapshot = { status, error };
    version++;
    runWithApplicationRuntime(runtime, () => publishVersions([key]));
  }

  function failPending(error: Error): void {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  function deliver(value: unknown): void {
    runWithApplicationRuntime(runtime, () => {
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (error) {
          if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
          else console.error(error);
        }
      }
    });
  }

  function receive(event: MessageEvent): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      socket?.close(1000, 'Invalid WebSocket response');
      return;
    }
    if (frame?.type === 'ready') {
      opened = true;
      retries = 0;
      state('open');
      ready.resolve(frame.value);
      if (frame.value !== undefined) deliver(frame.value);
    } else if (frame?.type === 'message') {
      deliver(frame.value);
    } else if (frame?.type === 'result' || frame?.type === 'error') {
      const request = pending.get(frame.id);
      pending.delete(frame.id);
      if (frame.type === 'error') request?.reject(new Error(frame.message));
      else request?.resolve(frame.value);
    }
  }

  function connect(url: URL): void {
    const current = new WebSocket(url);
    socket = current;
    current.addEventListener('message', (event) => {
      if (socket === current) receive(event);
    });
    current.addEventListener('close', (event) => {
      if (socket !== current) return;
      socket = undefined;
      const error = new Error(event.reason || 'WebSocket disconnected');
      failPending(error);
      if (!ended && opened && event.code !== 1000 && event.code !== 1008 && retries < MAX_RETRIES) {
        state('connecting');
        retry = setTimeout(() => connect(url), 250 * 2 ** retries++);
        return;
      }
      ready.reject(error);
      state(event.code === 1000 ? 'closed' : 'error', event.code === 1000 ? null : error);
    });
  }

  const connection: SocketConnection<unknown, unknown, unknown> = {
    ready: ready.promise,
    send(value) {
      if (socket === undefined || snapshot.status !== 'open') {
        return Promise.reject(new Error('WebSocket is not connected'));
      }
      if (pending.size >= MAX_PENDING) {
        return Promise.reject(new Error('Too many pending WebSocket messages'));
      }

      const id = ++nextId;
      const request = Promise.withResolvers<unknown>();
      try {
        socket.send(JSON.stringify({ id, value }));
        pending.set(id, request);
      } catch (error) {
        request.reject(error);
      }
      return request.promise;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close() {
      ended = true;
      clearTimeout(retry);
      const current = socket;
      socket = undefined;
      current?.close();
      const error = new Error('WebSocket closed');
      ready.reject(error);
      failPending(error);
      listeners.clear();
      state('closed');
    },
  };
  trackers.set(connection, () => trackRead(readVersion, snapshot, key));

  if (getActiveEnvironment().mode.startsWith('server-') || typeof location === 'undefined') {
    connection.close();
    return connection;
  }

  const url = new URL(path, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  connect(url);
  return connection;
}
