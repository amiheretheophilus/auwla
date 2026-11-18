import { createDraftroomRoom, draftroomBoard } from '#server-functions';
import type { createDocument } from '../model/document';
import type { Point, Shape, Tool } from '../model/types';
import { createEditSession } from './edit-session';
import { createPresenceSender } from './presence-sender';
import { normalizedCode, sameValue, validCode, type DragPreview, type Peer, type RoomIdentity, type RoomInitial, type RoomSnapshot, type RoomView } from './protocol';

type BoardConnection = ReturnType<typeof draftroomBoard>;

interface ActiveRoom {
  readonly identity: RoomIdentity;
  readonly socket: BoardConnection;
  readonly edits: ReturnType<typeof createEditSession>;
  readonly presence: ReturnType<typeof createPresenceSender>;
  readonly restore: () => void;
}

interface RoomDrag {
  pageId: string;
  preview: DragPreview;
  released: boolean;
}

function urlWith(code?: string): URL {
  const url = new URL(location.href);
  if (code === undefined) url.searchParams.delete('room');
  else url.searchParams.set('room', code);
  return url;
}

export function createRoomController(
  project: ReturnType<typeof createDocument>,
  publish: () => void,
  showCursors: (peers: Peer[]) => void,
) {
  const invite = typeof location === 'undefined' ? '' : normalizedCode(new URL(location.href).searchParams.get('room') ?? '');
  let room: ActiveRoom | undefined;
  let opening: BoardConnection | undefined;
  let starting = false;
  let generation = 0;
  let error: string | undefined;
  let peers: Peer[] = [];
  let live = false;
  let cursor: Point | null = null;
  let tool: Tool = 'select';
  let gesture: string | undefined;
  let typing = false;
  let drag: RoomDrag | undefined;
  let committingDrag: RoomDrag | undefined;

  function enter(code: string, name: string, initial: RoomInitial, snapshot: RoomSnapshot, socket: BoardConnection): void {
    const identity = $snapshot({ code, name });
    let visitor = initial.visitor;
    const edits = $snapshot(createEditSession(
      snapshot,
      project,
      async ({ id, patch }) => {
        const reply = await socket.send({ kind: 'edit', id, patch });
        return reply.kind === 'edit' ? reply.result : null;
      },
      () => gesture !== undefined || typing,
      publish,
    ));
    const restore = $snapshot(project.enterRoom(snapshot.project));
    const presence = $snapshot(createPresenceSender(() => {
      const pageId = project.page().id;
      return {
        name,
        pageId,
        cursor,
        action: gesture ?? (typing ? 'Editing text' : tool === 'select' ? 'Viewing board' : `Tool · ${tool}`),
        drag: drag?.pageId === pageId ? drag.preview : undefined,
      };
    }, async entry => {
      const reply = await socket.send({ kind: 'presence', entry });
      return reply.kind === 'presence' || (reply.kind === 'presence-ack' && reply.accepted);
    }));

    socket.onMessage(value => {
      if (value.kind === 'initial') {
        visitor = value.visitor;
        if (value.snapshot !== null) edits.receive(value.snapshot);
        receivePeers(code, visitor, value.people);
        presence.reconnect();
      } else if (value.kind === 'presence') {
        receivePeers(code, visitor, value.people);
      } else if (value.result !== null) {
        edits.receive(value.result.snapshot);
      }
    });
    room = { identity, socket, edits, presence, restore };
    receivePeers(code, visitor, initial.people);
    window.history.replaceState(null, '', urlWith(code));
    publish();
  }

  function start(name: string, roomCode: () => string | Promise<string>, failure: string): void {
    if (starting || room !== undefined) return;

    starting = true;
    error = undefined;
    const current = ++generation;
    publish();
    void connect();

    async function connect(): Promise<void> {
      let socket: BoardConnection | undefined;
      try {
        const code = await roomCode();
        if (generation !== current) return;

        socket = draftroomBoard(code);
        opening = socket;
        const initial = await socket.ready;
        if (generation !== current) return;
        if (initial.snapshot === null) throw new Error('Draftroom room not found');

        opening = undefined;
        starting = false;
        enter(code, name.trim().slice(0, 40) || 'Guest', initial, initial.snapshot, socket);
      } catch {
        socket?.close();
        if (generation !== current) return;

        opening = undefined;
        starting = false;
        error = failure;
        publish();
      }
    }
  }

  function create(name: string): void {
    start(name, async () => {
      const created = await createDraftroomRoom(project.project());
      return created.id;
    }, 'Could not create or connect to the Draftroom room.');
  }

  function join(input: string, name: string): void {
    const code = normalizedCode(input);
    if (!validCode(code)) {
      error = 'Enter the 12-character room ID.';
      publish();
      return;
    }
    start(name, () => code, 'Could not join the room. Check the room ID and try again.');
  }

  function close(): void {
    generation += 1;
    const current = room;
    room = undefined;
    opening?.close();
    opening = undefined;
    live = false;
    peers = [];
    cursor = null;
    gesture = undefined;
    typing = false;
    drag = undefined;
    committingDrag = undefined;
    starting = false;
    current?.edits.close();
    current?.socket.close();
    current?.presence.close();
    showCursors([]);
    current?.restore();
  }

  function leave(): void {
    if (room === undefined) return;
    if (room.edits.queued() > 0 && !window.confirm('Leave this room with unsynced edits? You can export a copy before leaving.')) return;

    close();
    error = undefined;
    window.history.replaceState(null, '', urlWith());
    publish();
  }

  function receivePeers(code: string, visitor: string, people: Peer[]): void {
    if (room?.identity.code !== code) return;

    const remote = people.filter(person => person.id !== visitor);
    showCursors(remote);
    const summary = remote.map(({ id, name, pageId, action }) => ({ id, name, pageId, action, cursor: null }));
    if (!sameValue(summary, peers)) {
      peers = summary;
      publish();
    }
  }

  function connected(code: string, value: boolean): void {
    if (room?.identity.code === code && live !== value) {
      live = value;
      publish();
    }
  }

  function record(): boolean {
    if (room === undefined) return false;

    const move = $snapshot(committingDrag);
    committingDrag = undefined;
    room.edits.change(project.project(), move === undefined ? undefined : revision => {
      if (drag !== move) return;

      // A tab can still be applying the saved edit when it receives this
      // preview. Keep the final position until it has applied that revision.
      drag = revision === undefined ? undefined : {
        ...move,
        preview: { ...move.preview, committedRevision: revision },
      };
      room?.presence.update();
    });
    room.presence.update();
    return true;
  }

  function previewMove(shapes: Shape[], committing = false): void {
    if (room === undefined) return;

    const anchor = shapes[0];
    // A click or cancellation should leave a previous drop waiting for its receipt.
    if (anchor === undefined && drag?.released) return;

    drag = anchor === undefined ? undefined : {
      pageId: project.page().id,
      released: committing,
      preview: {
        ids: shapes.map(shape => shape.id),
        anchor: { x: anchor.x, y: anchor.y },
      },
    };
    if (committing) committingDrag = drag;
    room.presence.update();
  }

  function setActivity(action?: string): void {
    gesture = action;
    if (action === undefined) room?.edits.reconcile();
    room?.presence.update();
  }

  function textActivity(value: boolean): void {
    typing = value;
    if (!value) room?.edits.reconcile();
    room?.presence.update();
  }

  function view(): RoomView {
    const edits = room?.edits;
    let status = starting ? 'Connecting…' : 'Local workspace';
    if (edits !== undefined) {
      if (edits.offline()) status = 'Sync paused';
      else if (edits.queued() > 0) status = 'Syncing changes…';
      else status = live ? 'Live' : 'Connecting to live updates…';
    }

    return {
      identity: room?.identity, peers, status, busy: starting,
      invite, error: edits?.error() ?? error,
    };
  }

  function copyInvite(): void {
    if (room === undefined || navigator.clipboard === undefined) return;
    void navigator.clipboard.writeText(urlWith(room.identity.code).href).then(() => {
      error = undefined;
      publish();
    }, () => {
      error = 'Copy the room ID to invite someone.';
      publish();
    });
  }

  return {
    create, join, leave, close, connected, view, record, previewMove, setActivity, textActivity, copyInvite,
    socket: () => room?.socket,
    active: () => room !== undefined,
    revision: () => room?.edits.revision() ?? 0,
    canUndo: () => room?.edits.canUndo() ?? project.canUndo(),
    canRedo: () => room?.edits.canRedo() ?? project.canRedo(),
    retry: () => room?.edits.retry(),
    travel(direction: 'undo' | 'redo') {
      if (room === undefined) project.travel(direction);
      else room.edits.travel(direction);
    },
    move(position: Point | null) {
      cursor = position;
      room?.presence.update();
    },
    tool(value: Tool) {
      tool = value;
      room?.presence.update();
    },
  };
}
