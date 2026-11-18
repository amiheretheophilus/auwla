import type { Bounds, Page, Shape } from './types';

export const FRAME_HEADER = 28;

export function contains(outer: Bounds, inner: Bounds): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function frameContents(page: Page, frame: Shape): Shape[] {
  return page.shapes.filter(shape => shape.frameId === frame.id && !shape.hidden);
}

/** Use the smallest enclosing frame. Members keep their identity when the frame moves. */
export function updateMembership(shapes: Shape[]): Shape[] {
  const frames = shapes.filter(shape => shape.kind === 'frame' && !shape.hidden);
  return shapes.map(shape => {
    if (shape.kind === 'frame') {
      return shape;
    }

    let owner: Shape | undefined;
    for (const frame of frames) {
      if (contains(frame, shape) && (owner === undefined || frame.width * frame.height <= owner.width * owner.height)) {
        owner = frame;
      }
    }

    return owner?.id === shape.frameId ? shape : { ...shape, frameId: owner?.id };
  });
}

export function layerOrder(shapes: Shape[]): Shape[] {
  const frames = shapes.filter(shape => shape.kind === 'frame');
  return [...frames, ...shapes.filter(shape => shape.kind !== 'frame')];
}
