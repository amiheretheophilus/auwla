import { isPage, isProject, isShape } from '../model/files';
import type { Project } from '../model/types';
import type { PresenceInput, ProjectPatch } from '../rooms/protocol';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function shortText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && value.trim() !== '';
}

function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 2000 && value.every(id => shortText(id, 100))
    && new Set(value).size === value.length;
}

export function assertBoard(value: unknown): asserts value is Project {
  if (!isProject(value) || value.pages.length > 40 || value.pages.some(page => page.shapes.length > 2000)
    || JSON.stringify(value).length > 1_500_000) {
    throw new Error('Draftroom could not use this room project');
  }
}

function validPatchPage(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === 'add' || value.kind === 'remove') return isPage(value.page);
  if (value.kind !== 'edit' || !shortText(value.id, 100) || !Array.isArray(value.shapes)) return false;

  if (value.name !== undefined && (!record(value.name) || !shortText(value.name.before, 200) || !shortText(value.name.after, 200))) {
    return false;
  }
  if (value.order !== undefined && (!record(value.order) || !ids(value.order.before) || !ids(value.order.after))) {
    return false;
  }

  return value.shapes.length <= 2000 && value.shapes.every(change => record(change) && shortText(change.id, 100)
    && (change.before === null || (isShape(change.before) && change.before.id === change.id))
    && (change.after === null || (isShape(change.after) && change.after.id === change.id))
    && (change.before !== null || change.after !== null));
}

export function assertPatch(value: unknown): asserts value is ProjectPatch {
  if (!Array.isArray(value) || value.length === 0 || value.length > 80 || !value.every(validPatchPage)
    || JSON.stringify(value).length > 3_000_000) {
    throw new Error('Draftroom could not apply this room edit');
  }
}

export function validVisitor(id: string): boolean {
  return typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
}

function validPosition(value: unknown): boolean {
  return record(value) && typeof value.x === 'number' && typeof value.y === 'number'
    && Math.abs(value.x) < 1_000_000 && Math.abs(value.y) < 1_000_000;
}

function validDrag(value: unknown): boolean {
  if (!record(value) || !ids(value.ids) || value.ids.length === 0 || !validPosition(value.anchor)) {
    return false;
  }

  const revision = value.committedRevision;
  return revision === undefined || (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0);
}

export function validPresence(entry: unknown): entry is PresenceInput {
  if (!record(entry) || !shortText(entry.name, 40) || !shortText(entry.pageId, 100) || !shortText(entry.action, 55)) return false;

  return (entry.cursor === null || validPosition(entry.cursor))
    && (entry.drag === undefined || validDrag(entry.drag));
}
