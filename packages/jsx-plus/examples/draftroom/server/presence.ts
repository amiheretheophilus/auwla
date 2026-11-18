import { sameValue, type Peer, type PresenceInput, type RoomPresenceUpdate } from '../rooms/protocol';

const rooms = new Map<string, Map<string, Peer>>();
const MAX_PEERS = 32;

export function peers(code: string): Peer[] {
  return [...(rooms.get(code)?.values() ?? [])];
}

export function updatePresence(code: string, visitor: string, entry: PresenceInput): RoomPresenceUpdate | boolean {
  let visitors = rooms.get(code);
  if (visitors === undefined) {
    visitors = new Map();
    rooms.set(code, visitors);
  }

  const previous = visitors.get(visitor);
  if (previous === undefined && visitors.size >= MAX_PEERS) return false;

  const peer = {
    id: visitor,
    name: entry.name,
    pageId: entry.pageId,
    action: entry.action,
    cursor: entry.cursor,
    drag: entry.drag,
  };
  if (sameValue(previous, peer)) return true;

  visitors.set(visitor, peer);
  return { kind: 'presence', people: [...visitors.values()] };
}

export function removePresence(code: string, visitor: string): RoomPresenceUpdate | undefined {
  const visitors = rooms.get(code);
  if (visitors === undefined || !visitors.delete(visitor)) return undefined;

  if (visitors.size === 0) rooms.delete(code);
  return { kind: 'presence', people: [...visitors.values()] };
}
