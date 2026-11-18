export interface Point {
  x: number;
  y: number;
}

export interface Bounds extends Point {
  width: number;
  height: number;
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'pen' | 'text' | 'note' | 'frame';
export type Tool = 'select' | 'hand' | ShapeKind;
export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface Shape extends Bounds {
  id: string;
  kind: ShapeKind;
  title: string;
  text: string;
  stroke: string;
  fill: string;
  weight: number;
  line: LineStyle;
  opacity: number;
  hidden: boolean;
  locked: boolean;
  /** Arrow and pen points are relative to the drawable's origin. */
  points?: Point[];
  fromId?: string;
  toId?: string;
  groupId?: string;
  frameId?: string;
}

export interface Page {
  id: string;
  name: string;
  shapes: Shape[];
}

export interface Project {
  version: 1;
  activeId: string;
  pages: Page[];
}

export interface Camera extends Point {
  zoom: number;
}

export interface InlineTextView extends Point {
  shape: Shape;
  width: number;
}

export interface PresentationView {
  title: string;
  url: string;
  index: number;
  total: number;
}

export interface EditorView {
  pages: Page[];
  page: Page;
  selected: Shape | undefined;
  selection: Shape[];
  inlineText: InlineTextView | undefined;
  presentation: PresentationView | undefined;
  shareUrl: string | undefined;
  shareFrameId: string | undefined;
  sharing: boolean;
  tool: Tool;
  zoom: number;
  grid: boolean;
  snap: boolean;
  canUndo: boolean;
  canRedo: boolean;
  notice: string;
}

export function canEditText(shape: Shape | undefined): shape is Shape {
  return shape !== undefined && !shape.locked && shape.kind !== 'frame' && shape.points === undefined;
}

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  rectangle: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond', arrow: 'Arrow',
  pen: 'Drawing', text: 'Text', note: 'Sticky note', frame: 'Frame',
};

export const PALETTE = ['#292445', '#6b4ee6', '#3d74dc', '#18876d', '#d35e45', '#df9b24'];
export const FILLS = ['transparent', '#eee8ff', '#e2edff', '#ddf5ed', '#ffe6df', '#fff0bf'];

export function makeShape(kind: ShapeKind, bounds: Bounds, settings: Partial<Shape> = {}): Shape {
  return {
    id: crypto.randomUUID(), kind, ...bounds,
    title: SHAPE_NAMES[kind], text: '', stroke: '#292445', fill: 'transparent',
    weight: 2, line: 'solid', opacity: 1, hidden: false, locked: false,
    ...settings,
  };
}

export function makePage(name: string, shapes: Shape[] = []): Page {
  return { id: crypto.randomUUID(), name, shapes };
}
