import { resolveConnections } from './connections';
import { layerOrder, updateMembership } from './frames';
import type { Shape } from './types';

export function replaceShapes(current: Shape[], changes: Shape[]): Shape[] {
  const byId = new Map(changes.map(shape => [shape.id, shape]));
  const shapes = current.map(shape => {
    const replacement = byId.get(shape.id);
    byId.delete(shape.id);
    return replacement ?? shape;
  });
  return [...shapes, ...byId.values()];
}

export function prepareShapes(shapes: Shape[]): Shape[] {
  return layerOrder(updateMembership(resolveConnections(shapes)));
}

/** Pointer previews include changed connectors without editing the saved board. */
export function previewShapes(current: Shape[], changes: Shape[]): Shape[] {
  if (changes.length === 0) {
    return changes;
  }

  const resolved = resolveConnections(replaceShapes(current, changes));
  return resolved.filter((shape, index) => shape !== current[index]);
}
