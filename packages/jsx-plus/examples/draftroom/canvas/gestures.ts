import { startDrawing, updateDrawing, updateTransform, type DrawingDraft, type TransformDraft } from './drafts';
import { hitShape, snapPoint, toWorld, zoomCamera } from './geometry';
import type { Camera, Point, Shape, Tool } from '../model/types';

type Gesture =
  | { kind: 'pan'; start: Point; camera: Camera }
  | TransformDraft
  | DrawingDraft;

interface BoardInput {
  camera(): Camera;
  setCamera(camera: Camera): void;
  tool(): Tool;
  snap(): boolean;
  shapes(): Shape[];
  selected(): Shape | undefined;
  select(id?: string): void;
  preview(shape?: Shape): void;
  finish(shape: Shape): void;
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
  let pointer: number | undefined;
  let drag: Gesture | undefined;
  let changed: Shape | undefined;
  let space = false;

  function world(point: Point, allowSnap = true): Point {
    const position = toWorld(point, input.camera());
    return allowSnap && input.snap() ? snapPoint(position) : position;
  }

  function down(event: PointerEvent): void {
    if (pointer !== undefined || (event.button !== 0 && event.button !== 1)) {
      return;
    }

    // Give shortcuts to the board and let an active inspector field commit first.
    canvas.focus({ preventScroll: true });
    const screen = screenPoint(canvas, event);
    const camera = input.camera();
    const tool = input.tool();

    if (tool === 'hand' || space || event.button === 1) {
      drag = { kind: 'pan', start: screen, camera };
    } else if (tool === 'select') {
      const point = world(screen, false);
      const selected = input.selected();

      if (overResizeHandle(selected, point, camera.zoom)) {
        drag = { kind: 'resize', shape: selected, start: point };
      } else {
        const shape = hitShape(input.shapes(), point, camera.zoom);
        input.select(shape?.id);
        if (shape === undefined || shape.locked) {
          return;
        }
        drag = { kind: 'move', shape, start: point };
      }
    } else {
      drag = startDrawing(tool, world(screen, tool !== 'pen'));
      changed = drag.shape;
      input.preview(changed);
    }

    event.preventDefault();
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
  }

  function move(event: PointerEvent): void {
    if (event.pointerId !== pointer || drag === undefined) {
      return;
    }

    const screen = screenPoint(canvas, event);
    if (drag.kind === 'pan') {
      input.setCamera({
        ...drag.camera,
        x: drag.camera.x + screen.x - drag.start.x,
        y: drag.camera.y + screen.y - drag.start.y,
      });
      return;
    }

    if (drag.kind === 'draw') {
      changed = updateDrawing(drag, world(screen, drag.shape.kind !== 'pen'));
    } else {
      changed = updateTransform(drag, world(screen, false), input.camera().zoom, input.snap());
    }
    input.preview(changed);
  }

  function end(event: PointerEvent, commit: boolean): void {
    if (event.pointerId !== pointer) {
      return;
    }

    const final = changed;
    pointer = undefined;
    drag = undefined;
    changed = undefined;
    input.preview();
    if (commit && final !== undefined && (final.points === undefined || final.width + final.height > 2)) {
      input.finish(final);
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

  function keyDown(event: KeyboardEvent): void {
    const usingControl = event.target instanceof HTMLElement
      && event.target.closest('input, textarea, select, button, [contenteditable]');
    if (event.code !== 'Space' || usingControl) {
      return;
    }
    space = true;
    event.preventDefault();
  }
  function keyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      space = false;
    }
  }
  const blur = () => { space = false; };

  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  canvas.addEventListener('pointerdown', down, options);
  canvas.addEventListener('pointermove', move, options);
  canvas.addEventListener('pointerup', up, options);
  canvas.addEventListener('pointercancel', cancel, options);
  canvas.addEventListener('lostpointercapture', cancel, options);
  canvas.addEventListener('wheel', wheel, { ...options, passive: false });
  window.addEventListener('keydown', keyDown, options);
  window.addEventListener('keyup', keyUp, options);
  window.addEventListener('blur', blur, options);
  return () => listeners.abort();
}
