import { contains } from './frames';
import type { Bounds, Point, Shape } from './types';

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical';

export function groupMembers(shapes: Shape[], ids: readonly string[]): string[] {
  const groups = new Set(shapes.filter(shape => ids.includes(shape.id)).map(shape => shape.groupId));
  return shapes.filter(shape => ids.includes(shape.id) || (shape.groupId !== undefined && groups.has(shape.groupId)))
    .map(shape => shape.id);
}

export function movableShapes(shapes: Shape[], ids: readonly string[]): Shape[] {
  const frames = new Set(shapes.filter(shape => shape.kind === 'frame' && !shape.locked && ids.includes(shape.id)).map(shape => shape.id));
  return shapes.filter(shape => frames.has(shape.frameId ?? '') || (ids.includes(shape.id) && !shape.locked));
}

export function enclosedIds(shapes: Shape[], area: Bounds): string[] {
  return shapes.filter(shape => !shape.hidden && !shape.locked && contains(area, shape)).map(shape => shape.id);
}

export function translated(shapes: Shape[], offset: Point): Shape[] {
  return shapes.map(shape => ({ ...shape, x: shape.x + offset.x, y: shape.y + offset.y }));
}

export function cloneSelection(shapes: Shape[], offset: Point): Shape[] {
  const ids = new Map(shapes.map(shape => [shape.id, crypto.randomUUID()]));
  const groups = new Map<string, string>();

  return translated(shapes, offset).map(shape => {
    const group = shape.groupId;
    if (group !== undefined && !groups.has(group)) {
      groups.set(group, crypto.randomUUID());
    }

    return {
      ...shape,
      id: ids.get(shape.id)!,
      groupId: group === undefined ? undefined : groups.get(group),
      frameId: ids.get(shape.frameId ?? ''),
      fromId: ids.get(shape.fromId ?? ''),
      toId: ids.get(shape.toId ?? ''),
    };
  });
}

export function alignShapes(shapes: Shape[], alignment: Alignment): Shape[] {
  const horizontal = ['left', 'center', 'right', 'horizontal'].includes(alignment);
  const axis = horizontal ? 'x' : 'y';
  const size = horizontal ? 'width' : 'height';
  const near = Math.min(...shapes.map(shape => shape[axis]));
  const far = Math.max(...shapes.map(shape => shape[axis] + shape[size]));

  if (alignment === 'horizontal' || alignment === 'vertical') {
    const ordered = shapes.toSorted((first, second) => first[axis] - second[axis]);
    const used = ordered.reduce((total, shape) => total + shape[size], 0);
    const gap = (far - near - used) / (ordered.length - 1);
    let cursor = near;
    return ordered.map(shape => {
      const next = { ...shape, [axis]: cursor };
      cursor += shape[size] + gap;
      return next;
    });
  }

  return shapes.map(shape => {
    let position = near;
    if (alignment === 'right' || alignment === 'bottom') {
      position = far - shape[size];
    } else if (alignment === 'center' || alignment === 'middle') {
      position = (near + far - shape[size]) / 2;
    }
    return { ...shape, [axis]: position };
  });
}
