import type { Shape } from '../model/types';
import type { DragPreview, Peer } from '../rooms/protocol';

export function visibleDrags(peers: Peer[], pageId: string, revision: number): DragPreview[] {
  const drags: DragPreview[] = [];
  for (const peer of peers) {
    const drag = peer.drag;
    if (peer.pageId === pageId && drag !== undefined
      && (drag.committedRevision === undefined || drag.committedRevision > revision)) {
      drags.push(drag);
    }
  }
  return drags;
}

/** Use the committed shapes for style, size, and stacking. Preview only their positions. */
export function remoteMoves(shapes: Shape[], drags: DragPreview[]): Shape[] {
  if (drags.length === 0) {
    return [];
  }

  const originals = new Map(shapes.map(shape => [shape.id, shape]));
  const moved = new Map<string, Shape>();
  for (const drag of drags) {
    const anchor = originals.get(drag.ids[0]!);
    if (anchor === undefined) {
      continue;
    }

    const dx = drag.anchor.x - anchor.x;
    const dy = drag.anchor.y - anchor.y;
    if (dx === 0 && dy === 0) {
      continue;
    }

    for (const id of drag.ids) {
      const shape = originals.get(id);
      if (shape !== undefined) {
        moved.set(id, { ...shape, x: shape.x + dx, y: shape.y + dy });
      }
    }
  }
  return [...moved.values()];
}
