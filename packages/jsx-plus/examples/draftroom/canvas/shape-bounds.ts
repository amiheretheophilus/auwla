import type { Bounds, Shape } from '../model/types';
import { arrowHead, expandBounds, pointBounds, unionBounds } from './geometry';
import { textInkBounds } from './shape-text';

function pathInkBounds(shape: Shape): Bounds | undefined {
  const points = shape.points;
  if (points === undefined || points.length < 2) {
    return undefined;
  }

  // Imported paths can extend past their nominal box. Use the points that are actually drawn.
  let bounds = pointBounds(points);
  if (shape.kind === 'arrow') {
    const tips = arrowHead(points.at(-1)!, points.at(-2)!, shape.weight);
    bounds = unionBounds(bounds, pointBounds(tips))!;
  }

  return expandBounds({ ...bounds, x: bounds.x + shape.x, y: bounds.y + shape.y }, shape.weight / 2);
}

export function shapeInkBounds(ctx: CanvasRenderingContext2D, shape: Shape): Bounds | undefined {
  if (shape.hidden || shape.opacity === 0) {
    return undefined;
  }

  let body: Bounds | undefined;
  if (shape.kind === 'arrow' || shape.kind === 'pen') {
    body = pathInkBounds(shape);
  } else if (shape.kind !== 'text') {
    const { x, y, width, height } = shape;
    body = expandBounds({ x, y, width, height }, shape.weight / 2);
  }

  return unionBounds(body, textInkBounds(ctx, shape));
}
