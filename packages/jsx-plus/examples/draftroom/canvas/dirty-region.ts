import type { Bounds, Camera, Shape } from '../model/types';
import { expandBounds, unionBounds } from './geometry';

export interface PreviewState {
  drafts: Map<string, Shape>;
  outlines: Shape[];
  marquee: Bounds | undefined;
}

function outlineBounds(shape: Shape | undefined, zoom: number): Bounds | undefined {
  if (shape === undefined || shape.hidden) {
    return undefined;
  }

  const { x, y, width, height } = shape;
  // Covers the selection frame, corner handle, and their strokes.
  return expandBounds({ x, y, width, height }, 11 / zoom);
}

export function changedBounds(
  before: PreviewState,
  after: PreviewState,
  shapes: Shape[],
  zoom: number,
  inkOf: (shape: Shape | undefined) => Bounds | undefined,
): Bounds | undefined {
  let dirty: Bounds | undefined;
  for (const state of [before, after]) {
    for (const shape of state.drafts.values()) {
      dirty = unionBounds(dirty, inkOf(shape));
    }
    for (const shape of state.outlines) {
      dirty = unionBounds(dirty, outlineBounds(shape, zoom));
    }
    if (state.marquee !== undefined) {
      dirty = unionBounds(dirty, expandBounds(state.marquee, 2 / zoom));
    }
  }

  // A draft replacing or revealing a committed object also changes the committed object's pixels.
  for (const shape of shapes) {
    if (before.drafts.has(shape.id) !== after.drafts.has(shape.id)) {
      dirty = unionBounds(dirty, inkOf(shape));
    }
  }

  return dirty;
}

export function visibleRegion(dirty: Bounds, canvas: HTMLCanvasElement, camera: Camera, density: number) {
  const scale = density * camera.zoom;
  const x = density * camera.x;
  const y = density * camera.y;

  // Round outwards in backing pixels and leave room for anti-aliased edges.
  const left = Math.max(0, Math.floor(x + dirty.x * scale) - 2);
  const top = Math.max(0, Math.floor(y + dirty.y * scale) - 2);
  const right = Math.min(canvas.width, Math.ceil(x + (dirty.x + dirty.width) * scale) + 2);
  const bottom = Math.min(canvas.height, Math.ceil(y + (dirty.y + dirty.height) * scale) + 2);
  if (left >= right || top >= bottom) {
    return undefined;
  }

  return {
    pixels: { x: left, y: top, width: right - left, height: bottom - top },
    world: {
      x: (left - x - 1) / scale,
      y: (top - y - 1) / scale,
      width: (right - left + 2) / scale,
      height: (bottom - top + 2) / scale,
    },
  };
}
