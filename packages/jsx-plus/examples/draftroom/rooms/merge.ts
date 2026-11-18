import { prepareShapes } from '../model/edits';
import type { Page, Project, Shape } from '../model/types';
import { sameValue, type BoardEdit, type Change, type ProjectPatch, type ShapeChange } from './protocol';

const fields = [
  'kind', 'x', 'y', 'width', 'height', 'title', 'text', 'stroke', 'fill', 'weight',
  'line', 'opacity', 'hidden', 'locked', 'points', 'fromId', 'toId', 'groupId',
] as const;

function mergeShape(current: Shape | undefined, change: ShapeChange): Shape | null | undefined {
  const { before, after } = change;
  if (after === null) {
    return current === undefined || sameValue(current, before) ? null : undefined;
  }
  if (before === null) {
    return current === undefined || sameValue(current, after) ? after : undefined;
  }
  if (current === undefined) {
    return undefined;
  }

  // Only write fields changed by this author. Other fields may already include a peer's edit.
  const merged = { ...current };
  for (const field of fields) {
    if (sameValue(before[field], after[field])) {
      continue;
    }
    if (!sameValue(current[field], before[field]) && !sameValue(current[field], after[field])) {
      return undefined;
    }
    Reflect.set(merged, field, after[field]);
  }
  return merged;
}

function reordered(shapes: Shape[], order: Change<string[]>): Shape[] | undefined {
  const before = new Set(order.before);
  const actual = shapes.filter(shape => before.has(shape.id)).map(shape => shape.id);
  const available = new Set(actual);
  const expectedAfter = order.after.filter(id => before.has(id) && available.has(id));
  if (!sameValue(actual, order.before.filter(id => available.has(id))) && !sameValue(actual, expectedAfter)) {
    return undefined;
  }

  // Keep slots occupied by objects another collaborator added while this reorder was pending.
  const byId = new Map(shapes.map(shape => [shape.id, shape]));
  const ordered = order.after.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  const memberIds = new Set(ordered.map(shape => shape.id));
  let index = 0;
  return shapes.map(shape => memberIds.has(shape.id) ? ordered[index++]! : shape);
}

function mergeBoard(page: Page, edit: BoardEdit): Page | undefined {
  const name = edit.name;
  if (name !== undefined && page.name !== name.before && page.name !== name.after) {
    return undefined;
  }

  const current = new Map(page.shapes.map(shape => [shape.id, shape]));
  for (const change of edit.shapes) {
    const shape = mergeShape(current.get(change.id), change);
    if (shape === undefined) {
      return undefined;
    }
    if (shape === null) {
      current.delete(change.id);
    } else {
      current.set(shape.id, shape);
    }
  }

  const shapes = [...current.values()];
  const ordered = edit.order === undefined ? shapes : reordered(shapes, edit.order);
  if (ordered === undefined) {
    return undefined;
  }
  return { ...page, name: name?.after ?? page.name, shapes: prepareShapes(ordered) };
}

/** Apply an entire edit or reject it if a field was changed incompatibly by another peer. */
export function mergeProject(project: Project, patch: ProjectPatch): Project | undefined {
  const pages = new Map(project.pages.map(page => [page.id, page]));
  for (const change of patch) {
    if (change.kind === 'edit') {
      const current = pages.get(change.id);
      const updated = current === undefined ? undefined : mergeBoard(current, change);
      if (updated === undefined) {
        return undefined;
      }
      pages.set(change.id, updated);
    } else {
      const page = change.page;
      const current = pages.get(page.id);
      if (current !== undefined && !sameValue(current, page)) {
        return undefined;
      }
      if (change.kind === 'add') {
        pages.set(page.id, { ...page, shapes: prepareShapes(page.shapes) });
      } else {
        pages.delete(page.id);
      }
    }
  }

  const result = [...pages.values()];
  if (result.length === 0) {
    return undefined;
  }
  return { ...project, activeId: pages.has(project.activeId) ? project.activeId : result[0]!.id, pages: result };
}
