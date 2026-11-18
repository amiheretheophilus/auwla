import { boundsFrom, pointBounds, snapPoint } from './geometry';
import { makeShape, type Point, type Shape, type ShapeKind } from '../model/types';

export interface DrawingDraft {
  kind: 'draw';
  start: Point;
  screenStart: Point;
  started: boolean;
  shape: Shape;
  samples: Point[];
}

export interface TransformDraft {
  kind: 'resize';
  start: Point;
  shape: Shape;
}

export function startDrawing(kind: ShapeKind, position: Point, screenStart: Point): DrawingDraft {
  let size = { width: 140, height: 90 };
  if (kind === 'text') {
    size = { width: 166, height: 36 };
  } else if (kind === 'frame') {
    size = { width: 320, height: 220 };
  }
  const shape = makeShape(kind, { ...position, ...size });

  if (kind === 'text') {
    shape.text = 'New text';
    shape.weight = 22;
  } else if (kind === 'note') {
    shape.text = 'New note';
    shape.stroke = '#aa7622';
    shape.fill = '#fff0bf';
  } else if (kind === 'arrow' || kind === 'pen') {
    shape.width = 0;
    shape.height = 0;
    shape.points = [];
  } else if (kind === 'frame') {
    shape.stroke = '#a790e0';
    shape.fill = '#faf8fe';
  } else {
    shape.stroke = '#6b4ee6';
    shape.fill = '#eee8ff';
  }

  return { kind: 'draw', start: position, screenStart, started: false, shape, samples: [position] };
}

export function updateDrawing(draft: DrawingDraft, point: Point): Shape {
  const { start, shape, samples } = draft;

  if (shape.kind === 'pen' || shape.kind === 'arrow') {
    if (shape.kind === 'pen') {
      samples.push(point);
    }

    const points = shape.kind === 'pen' ? samples : [start, point];
    const bounds = pointBounds(points);

    // Relative points let a stroke move as one object with a new origin.
    const relativePoints = points.map(sample => ({
      x: sample.x - bounds.x,
      y: sample.y - bounds.y,
    }));
    return { ...shape, ...bounds, points: relativePoints };
  }

  const bounds = boundsFrom(start, point);
  return {
    ...shape,
    ...bounds,
    width: Math.max(8, bounds.width),
    height: Math.max(8, bounds.height),
  };
}

export function updateTransform(draft: TransformDraft, point: Point, zoom: number, snap: boolean): Shape | undefined {
  const { shape, start } = draft;
  const dx = point.x - start.x;
  const dy = point.y - start.y;

  // The movement threshold is measured on screen, so a click behaves the same at any zoom.
  if (Math.hypot(dx, dy) * zoom < 2) {
    return undefined;
  }

  const size = { x: shape.width + dx, y: shape.height + dy };
  const adjusted = snap ? snapPoint(size) : size;
  return {
    ...shape,
    width: Math.max(12, adjusted.x),
    height: Math.max(12, adjusted.y),
  };
}
