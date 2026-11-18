import type { Page, Project, Shape } from '../model/types';
import { sameValue, type BoardEdit, type ProjectPatch, type ShapeChange } from './protocol';

const attachedGeometry = ['x', 'y', 'width', 'height', 'points'] as const;

/** Frame membership and geometry between two attached endpoints are derived on each peer. */
export function editableShape(shape: Shape, other: Shape): Shape {
  const result = { ...shape, frameId: undefined };
  if (shape.fromId !== undefined && shape.toId !== undefined && shape.fromId === other.fromId && shape.toId === other.toId) {
    for (const field of attachedGeometry) {
      Reflect.set(result, field, other[field]);
    }
  }
  return result;
}

function changedShapes(before: Page, after: Page): ShapeChange[] {
  const latest = new Map(after.shapes.map(shape => [shape.id, shape]));
  const edits: ShapeChange[] = [];
  for (const original of before.shapes) {
    const shape = latest.get(original.id);
    latest.delete(original.id);
    if (shape === undefined) {
      edits.push({ id: original.id, before: original, after: null });
    } else if (shape !== original) {
      const previous = { ...original, frameId: undefined };
      const next = editableShape(shape, original);
      if (!sameValue(previous, next)) {
        edits.push({ id: original.id, before: previous, after: next });
      }
    }
  }
  for (const shape of latest.values()) {
    edits.push({ id: shape.id, before: null, after: shape });
  }
  return edits;
}

function editBoard(before: Page, after: Page): BoardEdit {
  const shapes = changedShapes(before, after);
  const edit: BoardEdit = { kind: 'edit', id: before.id, shapes };
  if (before.name !== after.name) {
    edit.name = { before: before.name, after: after.name };
  }

  const original = before.shapes.map(shape => shape.id);
  const next = after.shapes.map(shape => shape.id);
  const originalSet = new Set(original);
  const nextSet = new Set(next);
  const commonBefore = original.filter(id => nextSet.has(id));
  const commonAfter = next.filter(id => originalSet.has(id));
  const appended = [...commonBefore, ...next.filter(id => !originalSet.has(id))];
  if (!sameValue(commonBefore, commonAfter) || !sameValue(appended, next)) {
    edit.order = { before: commonBefore, after: next };
  }
  return edit;
}

export function diffProject(before: Project, after: Project): ProjectPatch {
  const patch: ProjectPatch = [];
  const latest = new Map(after.pages.map(page => [page.id, page]));
  for (const page of before.pages) {
    const current = latest.get(page.id);
    latest.delete(page.id);
    if (current === undefined) {
      patch.push({ kind: 'remove', page });
    } else if (current !== page) {
      const edit = editBoard(page, current);
      if (edit.shapes.length > 0 || edit.name !== undefined || edit.order !== undefined) {
        patch.push(edit);
      }
    }
  }
  for (const page of latest.values()) {
    patch.push({ kind: 'add', page });
  }
  return patch;
}
