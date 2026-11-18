import { Buffer } from 'node:buffer';
import { isSocketReply, type ServerSocketSession } from './definition';
import type { PreparedSocket } from './upgrade';

export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_QUEUED_MESSAGES = 64;

export interface SocketPeer {
  send(text: string): unknown;
  close(code: number, reason: string): void;
  readonly bufferedAmount?: number;
}

/** Native hosts can subscribe their peers without retaining a second peer list in JS. */
export interface RoomDelivery<Peer extends SocketPeer> {
  join(peer: Peer): void;
  leave(peer: Peer): void;
  send(peer: Peer, text: string): void;
  publish(text: string): void;
}

interface Room<Peer extends SocketPeer> {
  readonly key: string;
  readonly delivery: RoomDelivery<Peer>;
  tail: Promise<void>;
  jobs: number;
  members: number;
}

export interface Connection<Peer extends SocketPeer = SocketPeer> {
  readonly session: ServerSocketSession<unknown>;
  readonly peer: Peer;
  readonly room: Room<Peer>;
  state: 'opening' | 'open' | 'closed';
  pending: number;
}

function encode(frame: object): string {
  return sizedFrame(JSON.stringify(frame));
}

function sizedFrame(text: string): string {
  if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) {
    throw new RangeError('WebSocket message exceeds limit');
  }
  return text;
}

function write(peer: SocketPeer, text: string): void {
  if ((peer.bufferedAmount ?? 0) > MAX_MESSAGE_BYTES) {
    peer.close(1013, 'Client is receiving messages too slowly');
    return;
  }

  try {
    peer.send(text);
  } catch {
    peer.close(1011, 'WebSocket send failed');
  }
}

function perPeerDelivery<Peer extends SocketPeer>(): RoomDelivery<Peer> {
  const peers = new Set<Peer>();
  return {
    join(peer) {
      peers.add(peer);
    },
    leave(peer) {
      peers.delete(peer);
    },
    send: write,
    publish(text) {
      for (const peer of peers) write(peer, text);
    },
  };
}

function deliverResult<Peer extends SocketPeer>(connection: Connection<Peer>, id: number, result: unknown): void {
  const { room, peer } = connection;
  const privateReply = isSocketReply(result);
  const value = privateReply ? result.value : result;

  // Keep the field name "value" for toJSON(key). Both frames use that same
  // serialized field, and the longer acknowledgement bounds both frame sizes.
  const field = JSON.stringify({ value }).slice(1, -1);
  const body = field.length > 0 ? `,${field}` : '';
  const reply = sizedFrame(`{"type":"result","id":${id}${body}}`);

  if (!privateReply && value !== undefined && room.members > 0) {
    room.delivery.publish(`{"type":"message"${body}}`);
  }
  if (connection.state === 'open') room.delivery.send(peer, reply);
}

function broadcast<Peer extends SocketPeer>(room: Room<Peer>, value: unknown): void {
  if (value !== undefined && room.members > 0) {
    room.delivery.publish(encode({ type: 'message', value }));
  }
}

function incoming(text: string): { id: number; value: unknown } | undefined {
  if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) return undefined;
  try {
    const frame: unknown = JSON.parse(text);
    if (typeof frame !== 'object' || frame === null || !('id' in frame)
      || typeof frame.id !== 'number' || !Number.isSafeInteger(frame.id) || frame.id < 1) {
      return undefined;
    }
    return { id: frame.id, value: 'value' in frame ? frame.value : undefined };
  } catch {
    return undefined;
  }
}

/** Initial reads and edits share a queue so a new peer never misses an intervening edit. */
export function createSocketRooms<Peer extends SocketPeer = SocketPeer>(
  delivery: () => RoomDelivery<Peer> = perPeerDelivery,
) {
  const rooms = new Map<string, Room<Peer>>();

  function releaseRoom(room: Room<Peer>): void {
    if (room.jobs === 0 && room.members === 0 && rooms.get(room.key) === room) {
      rooms.delete(room.key);
    }
  }

  function enqueue(room: Room<Peer>, work: () => Promise<void>): Promise<void> {
    room.jobs++;
    const result = room.tail.then(work);
    room.tail = result.then(finish, finish);
    return result;

    function finish(): void {
      room.jobs--;
      releaseRoom(room);
    }
  }

  function open({ room: key, session }: PreparedSocket, peer: Peer): Connection<Peer> {
    let room = rooms.get(key);
    if (room === undefined) {
      room = { key, delivery: delivery(), tail: Promise.resolve(), jobs: 0, members: 0 };
      rooms.set(key, room);
    }

    const connection: Connection<Peer> = { session, peer, room, state: 'opening', pending: 0 };
    void enqueue(room, async () => {
      if (connection.state !== 'opening') return;

      const initial = session.initial;
      const value = await (typeof initial === 'function' ? initial() : initial);
      if (connection.state !== 'opening') return;

      const ready = encode({ type: 'ready', value });
      room.delivery.join(peer);
      room.members++;
      connection.state = 'open';
      room.delivery.send(peer, ready);
    }).catch(error => {
      console.error('[memo-dom] WebSocket initial read failed', error);
      peer.close(1011, 'WebSocket initial read failed');
    });
    return connection;
  }

  function message(connection: Connection<Peer>, text: string): void {
    if (connection.state !== 'open') return;

    const frame = incoming(text);
    if (frame === undefined || connection.pending >= MAX_QUEUED_MESSAGES) {
      connection.peer.close(1008, 'Invalid or excessive WebSocket messages');
      return;
    }

    connection.pending++;
    void enqueue(connection.room, async () => {
      if (connection.state !== 'open') return;

      const result = await connection.session.message(frame.value);
      deliverResult(connection, frame.id, result);
    }).catch(error => {
      console.error('[memo-dom] WebSocket message failed', error);
      if (connection.state === 'open') {
        const failure = encode({ type: 'error', id: frame.id, message: 'WebSocket message failed' });
        connection.room.delivery.send(connection.peer, failure);
      }
    }).finally(() => {
      connection.pending--;
    });
  }

  function close(connection: Connection<Peer>): void {
    const { state, peer, room, session } = connection;
    if (state === 'closed') return;

    connection.state = 'closed';
    if (state === 'open') {
      room.delivery.leave(peer);
      room.members--;
    }
    if (session.close === undefined) {
      releaseRoom(room);
      return;
    }

    void enqueue(room, async () => {
      const value = await session.close?.();
      if (!isSocketReply(value)) broadcast(room, value);
    }).catch(error => console.error('[memo-dom] WebSocket close handler failed', error));
  }

  return { open, message, close };
}
