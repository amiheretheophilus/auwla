import { define, page } from '../define';
import { Board } from '../components/Board';
import { Receipt } from '../components/Receipt';

// Deliberately instance-local demo storage. Restarting the server resets it.
const boards: Record<string, { title: string; count: number; renders: number }> = {
  orchard: { title: 'Orchard', count: 0, renders: 0 },
  harbor: { title: 'Harbor', count: 0, renders: 0 },
};

function findBoard(id: string) {
  const board = Object.hasOwn(boards, id) ? boards[id] : undefined;
  if (!board) throw new Error('Unknown board');
  return board;
}

export const getBoard = define.function({
  async get(_context, boardId: string) {
    const board = findBoard(boardId);
    const renderId = ++board.renders;
    console.log(`[page] render ${boardId} #${renderId}`);
    return page(
      <Board boardId={boardId} title={board.title} count={board.count} renderId={renderId} />
    );
  },
  live: (_context, boardId) => ['demo-board', boardId],
});

export const changeCount = define.function({
  async post(_context, boardId: string, delta: number) {
    if (delta !== 1 && delta !== -1) throw new Error('Use +1 or -1');
    const board = findBoard(boardId);
    board.count += delta;
    return { boardId, count: board.count };
  },
  updates: (_context, boardId, _delta) => ['demo-board', boardId],
});

// A finite GET: no live declaration and no SSE subscription.
export const getReceipt = define.function({
  async get() {
    return page(<Receipt title="No submission yet" saved={false} />);
  },
});

export const renameOrchard = define.function({
  async post(_context, title: string) {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Enter a title before saving');
    if (trimmed.length > 60) throw new Error('Use at most 60 characters');
    findBoard('orchard').title = trimmed;
    // A little latency makes the ordinary form pending state easy to see.
    await Bun.sleep(400);
    return page(<Receipt title={trimmed} saved={true} />);
  },
  updates: () => ['demo-board', 'orchard'],
});
