import type { Point, Shape } from './types';

export function isConnectable(shape: Shape | undefined): shape is Shape {
  return shape !== undefined && ['rectangle', 'ellipse', 'diamond', 'note'].includes(shape.kind);
}

function center(shape: Shape): Point {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

function edge(shape: Shape, towards: Point): Point {
  const origin = center(shape);
  const dx = towards.x - origin.x;
  const dy = towards.y - origin.y;
  const x = Math.abs(dx) / Math.max(1, shape.width / 2);
  const y = Math.abs(dy) / Math.max(1, shape.height / 2);

  let distance = Math.max(x, y);
  if (shape.kind === 'ellipse') {
    distance = Math.hypot(x, y);
  } else if (shape.kind === 'diamond') {
    distance = x + y;
  }

  if (distance === 0) {
    return { x: shape.x + shape.width, y: origin.y };
  }
  return { x: origin.x + dx / distance, y: origin.y + dy / distance };
}

function endpoint(arrow: Shape, point: Point): Point {
  return { x: arrow.x + point.x, y: arrow.y + point.y };
}

function resolveArrow(arrow: Shape, shapes: Map<string, Shape>): Shape {
  if (arrow.kind !== 'arrow' || (arrow.fromId === undefined && arrow.toId === undefined)) {
    return arrow;
  }

  const points = arrow.points!;
  const first = endpoint(arrow, points[0]!);
  const last = endpoint(arrow, points.at(-1)!);
  const from = shapes.get(arrow.fromId ?? '');
  const to = shapes.get(arrow.toId ?? '');
  const source = isConnectable(from) ? from : undefined;
  const target = isConnectable(to) && to !== source ? to : undefined;
  const start = source === undefined ? first : edge(source, target === undefined ? last : center(target));
  const end = target === undefined ? last : edge(target, source === undefined ? first : center(source));

  if (start.x === first.x && start.y === first.y && end.x === last.x && end.y === last.y
    && arrow.fromId === source?.id && arrow.toId === target?.id) {
    return arrow;
  }

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    ...arrow,
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    fromId: source?.id,
    toId: target?.id,
    points: [{ x: start.x - x, y: start.y - y }, { x: end.x - x, y: end.y - y }],
  };
}

/** Detached endpoints keep their last position when the connected card is deleted. */
export function resolveConnections(shapes: Shape[]): Shape[] {
  if (!shapes.some(shape => shape.fromId !== undefined || shape.toId !== undefined)) {
    return shapes;
  }

  const byId = new Map(shapes.map(shape => [shape.id, shape]));
  return shapes.map(shape => resolveArrow(shape, byId));
}
