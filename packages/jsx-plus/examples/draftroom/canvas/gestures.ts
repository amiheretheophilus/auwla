import { startDrawing, updateDrawing, updateTransform, type DrawingDraft, type TransformDraft } from './drafts';
import { boundsFrom, hitShape, snapPoint, toWorld, zoomCamera } from './geometry';
import { bindPanShortcut } from './pan-shortcut';
import { isConnectable } from '../model/connections';
import { enclosedIds, translated } from '../model/selection';
import type { Bounds, Camera, Point, Shape, Tool } from '../model/types';

type Gesture =
  | { kind: 'pan'; start: Point; camera: Camera }
  | { kind: 'marquee'; start: Point; extend: boolean }
  | { kind: 'move'; start: Point; shapes: Shape[]; anchor: Point }
  | TransformDraft
  | DrawingDraft;

interface ActivePointer {
  id: number;
  last: Point;
}

interface BoardInput {
  camera(): Camera;
  setCamera(camera: Camera): void;
  tool(): Tool;
  snap(): boolean;
  shapes(): Shape[];
  selected(): Shape | undefined;
  selection(): Shape[];
  movable(): Shape[];
  select(id?: string, toggle?: boolean): void;
  selectMany(ids: string[], extend: boolean): void;
  editText(id: string): void;
  preview(shapes: Shape[], marquee?: Bounds): void;
  finish(shapes: Shape[]): void;
}

export function screenPoint(element: Element, event: MouseEvent): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function overResizeHandle(shape: Shape | undefined, point: Point, zoom: number): shape is Shape {
  if (shape === undefined || shape.hidden || shape.locked || shape.points !== undefined) {
    return false;
  }

  // Match the offset of the selection handle drawn outside the object's corner.
  const spacing = 6 / zoom;
  const x = shape.x + shape.width + spacing;
  const y = shape.y + shape.height + spacing;
  return Math.hypot(point.x - x, point.y - y) <= 9 / zoom;
}

/** Pointer previews stay out of the project until a completed gesture reaches finish(). */
export function bindGestures(canvas: HTMLCanvasElement, input: BoardInput): () => void {
  let pointer: ActivePointer | undefined;
  let drag: Gesture | undefined;
  let changed: Shape[] = [];
  let marquee: Bounds | undefined;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const panShortcut = bindPanShortcut(canvas, listeners.signal, switchToPan);

  function world(point: Point, allowSnap = true): Point {
    const position = toWorld(point, input.camera());
    return allowSnap && input.snap() ? snapPoint(position) : position;
  }

  function beginPan(screen: Point): void {
    if (drag?.kind !== 'pan') {
      drag = { kind: 'pan', start: screen, camera: input.camera() };

      // Space takes over from an unfinished edit. The camera moves from the last pointer position.
      changed = [];
      marquee = undefined;
      input.preview([]);
    }
    panShortcut.begin();
  }

  function connectAt(point: Point): string | undefined {
    return hitShape(input.shapes().filter(isConnectable), point, input.camera().zoom)?.id;
  }

  function selectAt(screen: Point, shift: boolean): void {
    const point = world(screen, false);
    const selected = input.selected();
    if (!shift && overResizeHandle(selected, point, input.camera().zoom)) {
      drag = { kind: 'resize', shape: selected, start: point };
      return;
    }

    const shape = hitShape(input.shapes(), point, input.camera().zoom);
    if (shape === undefined) {
      drag = { kind: 'marquee', start: point, extend: shift };
      return;
    }

    const selection = input.selection();
    const alreadySelected = selection.some(item => item.id === shape.id);
    if (shift || !alreadySelected || (selection.length === 1 && shape.groupId !== undefined)) {
      input.select(shape.id, shift);
    }
    if (!shift && !shape.locked) {
      drag = { kind: 'move', shapes: input.movable(), anchor: shape, start: point };
    }
  }

  function switchToPan(): void {
    if (pointer !== undefined) {
      beginPan(pointer.last);
    }
  }

  function down(event: PointerEvent): void {
    if (pointer !== undefined || (event.button !== 0 && event.button !== 1)) {
      return;
    }

    const spaceHeld = panShortcut.held();

    // Give shortcuts to the board and let an active inspector field commit first.
    canvas.focus({ preventScroll: true });
    const screen = screenPoint(canvas, event);
    const tool = input.tool();

    if (tool === 'hand' || spaceHeld || event.button === 1) {
      beginPan(screen);
    } else if (tool === 'select') {
      selectAt(screen, event.shiftKey);
    } else {
      drag = startDrawing(tool, world(screen, tool !== 'pen'), screen);
      if (tool === 'arrow') {
        drag.shape.fromId = connectAt(world(screen, false));
      }
    }

    event.preventDefault();
    // Track presses on empty or locked areas too. Space can turn a held press into a pan.
    pointer = { id: event.pointerId, last: screen };
    canvas.setPointerCapture(event.pointerId);
  }

  function moveSelection(gesture: Extract<Gesture, { kind: 'move' }>, point: Point): Shape[] {
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    if (Math.hypot(dx, dy) * input.camera().zoom < 2) {
      return [];
    }

    const anchor = gesture.anchor;
    const offset = input.snap() ? snapPoint({ x: anchor.x + dx, y: anchor.y + dy }) : { x: anchor.x + dx, y: anchor.y + dy };
    return translated(gesture.shapes, { x: offset.x - anchor.x, y: offset.y - anchor.y });
  }

  function move(event: PointerEvent): void {
    if (event.pointerId !== pointer?.id) {
      return;
    }

    const screen = screenPoint(canvas, event);
    pointer.last = screen;
    if (drag === undefined) {
      return;
    }

    if (drag.kind === 'pan') {
      input.setCamera({
        ...drag.camera,
        x: drag.camera.x + screen.x - drag.start.x,
        y: drag.camera.y + screen.y - drag.start.y,
      });
      return;
    }

    if (drag.kind === 'draw') {
      // Until the pointer moves, the gesture might be a click that places a default-size shape.
      const distance = Math.hypot(screen.x - drag.screenStart.x, screen.y - drag.screenStart.y);
      if (!drag.started && distance < 3) {
        return;
      }
      drag.started = true;
      const shape = updateDrawing(drag, world(screen, drag.shape.kind !== 'pen'));
      if (shape.kind === 'arrow') {
        const target = connectAt(world(screen, false));
        changed = [{ ...shape, toId: target === shape.fromId ? undefined : target }];
      } else {
        changed = [shape];
      }
    } else if (drag.kind === 'marquee') {
      const point = world(screen, false);
      const distance = Math.hypot(point.x - drag.start.x, point.y - drag.start.y) * input.camera().zoom;
      marquee = distance < 3 ? undefined : boundsFrom(drag.start, point);
    } else if (drag.kind === 'move') {
      changed = moveSelection(drag, world(screen, false));
    } else {
      const shape = updateTransform(drag, world(screen, false), input.camera().zoom, input.snap());
      changed = shape === undefined ? [] : [shape];
    }
    input.preview(changed, marquee);
  }

  function end(event: PointerEvent, commit: boolean): void {
    if (event.pointerId !== pointer?.id) {
      return;
    }

    if (commit && drag?.kind === 'draw' && !drag.started) {
      move(event);
    }
    let final = changed;
    if (drag?.kind === 'draw' && !drag.started && drag.shape.points === undefined) {
      final = [drag.shape];
    }
    if (commit && drag?.kind === 'marquee') {
      const ids = marquee === undefined ? [] : enclosedIds(input.shapes(), marquee);
      input.selectMany(ids, drag.extend);
    }

    pointer = undefined;
    drag = undefined;
    changed = [];
    marquee = undefined;
    panShortcut.end();
    input.preview([]);
    if (commit) {
      const edits = final.filter(shape => shape.points === undefined || shape.width + shape.height > 2);
      if (edits.length > 0) {
        input.finish(edits);
      }
    }
  }

  const up = (event: PointerEvent) => end(event, true);
  const cancel = (event: PointerEvent) => end(event, false);
  function wheel(event: WheelEvent): void {
    event.preventDefault();
    const camera = input.camera();
    const factor = event.deltaMode === 1 ? 18 : 1;
    if (event.ctrlKey || event.metaKey) {
      input.setCamera(zoomCamera(camera, Math.exp(-event.deltaY * factor * 0.002), screenPoint(canvas, event)));
    } else {
      input.setCamera({
        ...camera,
        x: camera.x - event.deltaX * factor,
        y: camera.y - event.deltaY * factor,
      });
    }
  }

  function editText(event: MouseEvent): void {
    if (input.tool() !== 'select' || panShortcut.held()) {
      return;
    }

    const point = world(screenPoint(canvas, event), false);
    const shape = hitShape(input.shapes(), point, input.camera().zoom);
    if (shape !== undefined) {
      input.editText(shape.id);
    }
  }

  canvas.addEventListener('pointerdown', down, options);
  canvas.addEventListener('pointermove', move, options);
  canvas.addEventListener('pointerup', up, options);
  canvas.addEventListener('pointercancel', cancel, options);
  canvas.addEventListener('lostpointercapture', cancel, options);
  canvas.addEventListener('dblclick', editText, options);
  canvas.addEventListener('wheel', wheel, { ...options, passive: false });
  return () => listeners.abort();
}
