import type { Page, Point, Project, Shape } from '../model/types';

export interface Change<T> {
  before: T;
  after: T;
}

export interface ShapeChange extends Change<Shape | null> {
  id: string;
}

export interface BoardEdit {
  kind: 'edit';
  id: string;
  name?: Change<string>;
  shapes: ShapeChange[];
  order?: Change<string[]>;
}

export type BoardChange = BoardEdit | { kind: 'add' | 'remove'; page: Page };
export type ProjectPatch = BoardChange[];

export interface RoomSnapshot {
  revision: number;
  project: Project;
}

export interface RoomCreated extends RoomSnapshot {
  id: string;
}

export interface EditResult {
  accepted: boolean;
  snapshot: RoomSnapshot;
}

export interface DragPreview {
  /** The first shape is the anchor. All the shapes share its displacement. */
  ids: string[];
  anchor: Point;
  /** Keep the preview until this board revision has arrived. */
  committedRevision?: number;
}

export interface PresenceInput {
  name: string;
  pageId: string;
  action: string;
  cursor: Point | null;
  drag?: DragPreview;
}

export interface Peer extends PresenceInput {
  id: string;
}

export type RoomCommand =
  | { kind: 'edit'; id: string; patch: ProjectPatch }
  | { kind: 'presence'; entry: PresenceInput };

export interface RoomInitial {
  kind: 'initial';
  visitor: string;
  snapshot: RoomSnapshot | null;
  people: Peer[];
}

export interface RoomEditUpdate {
  kind: 'edit';
  result: EditResult | null;
}

export interface RoomPresenceUpdate {
  kind: 'presence';
  people: Peer[];
}

export type RoomUpdate = RoomEditUpdate | RoomPresenceUpdate;
export type RoomResponse = RoomUpdate | { kind: 'presence-ack'; accepted: boolean } | { kind: 'invalid' };

export interface RoomIdentity {
  code: string;
  name: string;
}

export interface RoomView {
  identity: RoomIdentity | undefined;
  peers: Peer[];
  status: string;
  busy: boolean;
  invite: string;
  error: string | undefined;
}

export function normalizedCode(code: string): string {
  return code.trim().replaceAll('-', '').toUpperCase();
}

export function validCode(code: string): boolean {
  return /^[2-9A-HJ-NP-Z]{12}$/.test(code);
}

export function sameValue(first: unknown, second: unknown): boolean {
  return first === second || JSON.stringify(first) === JSON.stringify(second);
}
