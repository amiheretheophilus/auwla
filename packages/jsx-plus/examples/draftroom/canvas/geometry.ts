import type { Bounds, Camera, Point, Shape } from '../model/types';
import { FRAME_HEADER } from '../model/frames';

export const GRID = 24;

export function toWorld(point: Point, camera: Camera): Point {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

export function snapPoint(point: Point): Point {
  return {
    x: Math.round(point.x / GRID) * GRID,
    y: Math.round(point.y / GRID) * GRID,
  };
}

export function boundsFrom(start: Point, end: Point): Bounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function unionBounds(first: Bounds | undefined, second: Bounds | undefined): Bounds | undefined {
  if (first === undefined || second === undefined) {
    return first ?? second;
  }

  const start = { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y) };
  const end = {
    x: Math.max(first.x + first.width, second.x + second.width),
    y: Math.max(first.y + first.height, second.y + second.height),
  };
  return boundsFrom(start, end);
}

export function expandBounds(bounds: Bounds, margin: number): Bounds {
  return {
    x: bounds.x - margin,
    y: bounds.y - margin,
    width: bounds.width + margin * 2,
    height: bounds.height + margin * 2,
  };
}

export function boundsIntersect(first: Bounds, second: Bounds): boolean {
  return first.x <= second.x + second.width && second.x <= first.x + first.width
    && first.y <= second.y + second.height && second.y <= first.y + first.height;
}

export function arrowHead(end: Point, previous: Point, weight: number): [Point, Point] {
  const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
  const length = 9 + weight * 1.2;

  return [
    { x: end.x - length * Math.cos(angle - 0.52), y: end.y - length * Math.sin(angle - 0.52) },
    { x: end.x - length * Math.cos(angle + 0.52), y: end.y - length * Math.sin(angle + 0.52) },
  ];
}

export function pointBounds(points: readonly Point[]): Bounds {
  let left = points[0]!.x;
  let right = left;
  let top = points[0]!.y;
  let bottom = top;

  for (const point of points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function drawingBounds(shapes: readonly Shape[]): Bounds | undefined {
  const visible = shapes.filter(shape => !shape.hidden);
  if (visible.length === 0) {
    return undefined;
  }

  return pointBounds(visible.flatMap(shape => [
    { x: shape.x, y: shape.y },
    { x: shape.x + shape.width, y: shape.y + shape.height },
  ]));
}

function distanceToSegment(point: Point, first: Point, second: Point): number {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - first.x, point.y - first.y);
  }

  const fraction = ((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared;
  const progress = Math.max(0, Math.min(1, fraction));
  return Math.hypot(point.x - first.x - dx * progress, point.y - first.y - dy * progress);
}

export function hitShape(shapes: readonly Shape[], position: Point, zoom: number): Shape | undefined {
  return shapes.findLast(shape => {
    if (shape.hidden) {
      return false;
    }

    const point = { x: position.x - shape.x, y: position.y - shape.y };
    const tolerance = 7 / zoom;
    if (shape.kind === 'frame') {
      const inside = point.x >= -tolerance && point.x <= shape.width + tolerance
        && point.y >= -tolerance && point.y <= shape.height + tolerance;
      return inside && (point.y <= FRAME_HEADER || point.y >= shape.height - tolerance
        || point.x <= tolerance || point.x >= shape.width - tolerance);
    }

    if (shape.points !== undefined) {
      const points = shape.points;
      return points.some((current, index) => {
        const previous = points[index - 1];
        return previous !== undefined && distanceToSegment(point, previous, current) <= tolerance;
      });
    }

    const halfWidth = shape.width / 2;
    const halfHeight = shape.height / 2;
    const horizontal = Math.abs(point.x - halfWidth) / (halfWidth + tolerance);
    const vertical = Math.abs(point.y - halfHeight) / (halfHeight + tolerance);
    if (shape.kind === 'ellipse') {
      return Math.hypot(horizontal, vertical) <= 1;
    }
    if (shape.kind === 'diamond') {
      return horizontal + vertical <= 1;
    }

    return point.x >= -tolerance && point.x <= shape.width + tolerance
      && point.y >= -tolerance && point.y <= shape.height + tolerance;
  });
}

export function fitCamera(bounds: Bounds | undefined, width: number, height: number): Camera {
  if (bounds === undefined) {
    return { x: 0, y: 0, zoom: 1 };
  }

  // Leave space around the drawing for the floating controls.
  const horizontalFit = (width - 56) / Math.max(1, bounds.width);
  const verticalFit = (height - 148) / Math.max(1, bounds.height);
  const zoom = Math.max(0.16, Math.min(1, horizontalFit, verticalFit));
  return {
    zoom,
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 + 18 - (bounds.y + bounds.height / 2) * zoom,
  };
}

export function zoomCamera(camera: Camera, factor: number, anchor: Point): Camera {
  const zoom = Math.max(0.12, Math.min(4, camera.zoom * factor));
  const world = toWorld(anchor, camera);
  return {
    zoom,
    x: anchor.x - world.x * zoom,
    y: anchor.y - world.y * zoom,
  };
}
