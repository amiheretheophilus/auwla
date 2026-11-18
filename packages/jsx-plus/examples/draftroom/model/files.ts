import { SHAPE_NAMES, type Page, type Point, type Project, type Shape } from './types';

const STORAGE_KEY = 'auwla-draftroom-v1';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e6;
}

function point(value: unknown): value is Point {
  return record(value) && finite(value.x) && finite(value.y);
}

function color(value: unknown): boolean {
  return value === 'transparent' || (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value));
}

function validPoints(shape: Record<string, unknown>): boolean {
  if (shape.kind === 'arrow' || shape.kind === 'pen') {
    return Array.isArray(shape.points) && shape.points.length >= 2 && shape.points.every(point);
  }
  return shape.points === undefined;
}

function optionalId(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0);
}

export function isShape(value: unknown): value is Shape {
  if (!record(value)) {
    return false;
  }

  const dimensions = finite(value.x) && finite(value.y)
    && finite(value.width) && value.width >= 0
    && finite(value.height) && value.height >= 0;
  const appearance = color(value.stroke) && color(value.fill)
    && finite(value.weight) && value.weight > 0 && value.weight <= 100
    && finite(value.opacity) && value.opacity >= 0 && value.opacity <= 1;

  return dimensions && appearance
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.kind === 'string' && Object.hasOwn(SHAPE_NAMES, value.kind)
    && typeof value.title === 'string' && typeof value.text === 'string'
    && (value.line === 'solid' || value.line === 'dashed' || value.line === 'dotted')
    && typeof value.hidden === 'boolean' && typeof value.locked === 'boolean'
    && optionalId(value.frameId) && optionalId(value.groupId)
    && optionalId(value.fromId) && optionalId(value.toId)
    && (value.kind === 'arrow' || (value.fromId === undefined && value.toId === undefined))
    && validPoints(value);
}

function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map(item => item.id)).size === items.length;
}

export function isPage(value: unknown): value is Page {
  return record(value)
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.name === 'string'
    && Array.isArray(value.shapes) && value.shapes.every(isShape) && uniqueIds(value.shapes);
}

export function isProject(value: unknown): value is Project {
  if (!record(value) || value.version !== 1 || typeof value.activeId !== 'string') {
    return false;
  }

  const pages = value.pages;
  return Array.isArray(pages) && pages.every(isPage) && uniqueIds(pages)
    && pages.some(page => page.id === value.activeId);
}

/** Local files share the same format as the autosave and are validated before use. */
function decode(text: string): Project {
  const value: unknown = JSON.parse(text);
  if (!isProject(value)) {
    throw new Error('This file is not a Draftroom project.');
  }
  return value;
}

export function decodeClipboard(text: string): Shape[] | undefined {
  const value: unknown = JSON.parse(text);
  if (Array.isArray(value) && value.length > 0 && value.length <= 2000 && value.every(isShape) && uniqueIds(value)) {
    return value;
  }
  return undefined;
}

export async function readAutosave(): Promise<Project | undefined> {
  const text = localStorage.getItem(STORAGE_KEY);
  return text === null ? undefined : decode(text);
}

export async function writeAutosave(value: Project): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export async function openProject(file: File): Promise<Project> {
  return decode(await file.text());
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();

  // Let the browser open the download before releasing its temporary URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
