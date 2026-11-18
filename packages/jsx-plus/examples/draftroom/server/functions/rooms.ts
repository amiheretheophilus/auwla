import { replyToSocket, type SocketReply } from '@memoized-dom/server';
import type { Project } from '../../model/types';
import type { RoomCommand, RoomInitial, RoomResponse, RoomUpdate } from '../../rooms/protocol';
import { define } from '../define';
import { peers, removePresence, updatePresence } from '../presence';
import { createRoom, readRoom, roomExists, writeRoom } from '../room-store';
import { validPresence } from '../room-validation';

export const createDraftroomRoom = define.function({
  async post(_context, project: Project) {
    return createRoom(project);
  },
});

export const draftroomBoard = define.function({
  websocket(_context, code: string) {
    if (typeof code !== 'string' || !roomExists(code)) {
      return new Response('Draftroom room not found', { status: 404 });
    }

    const visitor = crypto.randomUUID();
    return {
      initial: (): RoomInitial => ({
        kind: 'initial',
        visitor,
        snapshot: readRoom(code),
        people: peers(code),
      }),
      message(command: RoomCommand): RoomUpdate | SocketReply<RoomResponse> {
        if (command?.kind === 'edit' && typeof command.id === 'string' && Array.isArray(command.patch)) {
          const result = writeRoom(code, command.id, command.patch);
          const update = { kind: 'edit', result } as const;
          return result?.accepted ? update : replyToSocket(update);
        }
        if (command?.kind === 'presence' && validPresence(command.entry)) {
          const update = updatePresence(code, visitor, command.entry);
          return typeof update === 'boolean' ? replyToSocket({ kind: 'presence-ack', accepted: update }) : update;
        }
        return replyToSocket({ kind: 'invalid' });
      },
      close: () => removePresence(code, visitor),
    };
  },
  live: (_context, code) => ['draftroom-board', code],
});
