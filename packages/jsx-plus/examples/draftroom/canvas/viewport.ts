import { createBoardPainter } from './board-painter';
import { drawingBounds, fitCamera, GRID, toWorld, zoomCamera } from './geometry';
import { bindGestures, screenPoint } from './gestures';
import { mapPosition, paintMap } from './paint';
import { canvasSize } from './surface';
import { createRemoteCursors } from './remote-cursors';
import { remoteMoves, visibleDrags } from './remote-drags';
import { previewShapes } from '../model/edits';
import type { Bounds, Camera, InlineTextView, Point, Shape, Tool } from '../model/types';
import { sameValue, type Peer } from '../rooms/protocol';

interface Scene {
  shapes(): Shape[];
  selected(): Shape | undefined;
  selection(): Shape[];
  movable(): Shape[];
  tool(): Tool;
  snap(): boolean;
  select(id?: string, toggle?: boolean): void;
  selectMany(ids: string[], extend: boolean): void;
  editText(id: string): void;
  activity(action?: string): void;
  tracksPresence(): boolean;
  pointer(position: Point | null): void;
  previewMove(shapes: Shape[]): void;
  page(): string;
  revision(): number;
  finish(shapes: Shape[], moved: boolean): void;
  changed(zoomChanged: boolean): void;
}

/** The CSS grid sits behind the canvas bitmap and only moves with the camera. */
function positionGrid(canvas: HTMLCanvasElement, camera: Camera): void {
  const spacing = GRID * camera.zoom * (camera.zoom < 0.35 ? 4 : 1);
  // The center of each CSS dot is 1.25px inside its tile.
  const left = camera.x % spacing - 1.25;
  const top = camera.y % spacing - 1.25;
  canvas.style.setProperty('--grid-spacing', `${spacing}px`);
  canvas.style.setProperty('--grid-origin', `${left}px ${top}px`);
}

export function createViewport(scene: Scene) {
  const painter = createBoardPainter();
  const cursors = createRemoteCursors();
  let board: HTMLCanvasElement | undefined;
  let map: HTMLCanvasElement | undefined;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let drafts: Shape[] = [];
  let marquee: Bounds | undefined;
  let textDraft: Shape | undefined;
  let frame = 0;
  let fitted = false;
  let peers: Peer[] = [];
  let mappedShapes: Shape[] | undefined;
  let mappedCamera: Camera | undefined;

  function paintOverview(canvas: HTMLCanvasElement, shapes: Shape[]): void {
    if (map === undefined || (mappedShapes === shapes && mappedCamera === camera)) {
      return;
    }

    paintMap(map, canvas, shapes, camera);
    mappedShapes = shapes;
    mappedCamera = camera;
  }

  function render(): void {
    if (frame !== 0 || board === undefined) {
      return;
    }

    // Several pointer events can arrive before the next paint. Draw the latest preview once.
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (board === undefined) {
        return;
      }

      const shapes = scene.shapes();
      const pageId = scene.page();
      const edits = drafts.length === 0 && textDraft !== undefined ? [textDraft] : drafts;
      const drags = peers.length === 0 ? [] : visibleDrags(peers, pageId, scene.revision());
      const remote = remoteMoves(shapes, drags);
      // If two people drag the same shape, the local pointer keeps control of its preview.
      const updates = previewShapes(shapes, remote.length === 0 ? edits : [...remote, ...edits]);
      painter.paint(board, shapes, camera, scene.selection(), updates, marquee, edits.length === 1 ? edits[0]?.id : undefined);
      cursors.show(peers, camera, pageId);
      // A drag's draft is only for the main board. The map catches up when the edit commits.
      paintOverview(board, shapes);
    });
  }

  function setCamera(next: Camera): void {
    const zoomChanged = Math.round(camera.zoom * 100) !== Math.round(next.zoom * 100);
    camera = next;
    if (board !== undefined) {
      positionGrid(board, camera);
    }
    scene.changed(zoomChanged);
    cursors.show(peers, camera, scene.page());
    render();
  }

  function fit(target?: Bounds): void {
    if (board === undefined) {
      return;
    }

    const { width, height } = canvasSize(board);
    if (width === 0 || height === 0) {
      return;
    }
    fitted = true;
    setCamera(fitCamera(target ?? drawingBounds(scene.shapes()), width, height));
  }

  function attachBoard(canvas: HTMLCanvasElement): () => void {
    board = canvas;
    fitted = false;
    positionGrid(canvas, camera);
    const detach = bindGestures(canvas, {
      camera: () => camera,
      setCamera,
      tool: scene.tool,
      snap: scene.snap,
      shapes: scene.shapes,
      selected: scene.selected,
      selection: scene.selection,
      movable: scene.movable,
      select: scene.select,
      selectMany: scene.selectMany,
      editText: scene.editText,
      activity: scene.activity,
      previewMove: scene.previewMove,
      finish: scene.finish,
      preview(shapes, area) {
        drafts = shapes;
        marquee = area;
        render();
      },
    });

    const observer = new ResizeObserver(() => {
      // The viewport outline in the minimap also depends on the visible canvas size.
      mappedCamera = undefined;
      if (!fitted) {
        fit();
      } else {
        scene.changed(false);
      }
      render();
    });
    observer.observe(canvas);

    function restoreContext(): void {
      painter.clear();
      render();
    }
    canvas.addEventListener('contextrestored', restoreContext);

    function pointer(event: PointerEvent): void {
      if (scene.tracksPresence()) scene.pointer(toWorld(screenPoint(canvas, event), camera));
    }
    function leave(): void {
      if (scene.tracksPresence()) scene.pointer(null);
    }
    canvas.addEventListener('pointermove', pointer);
    canvas.addEventListener('pointerleave', leave);

    return () => {
      detach();
      observer.disconnect();
      canvas.removeEventListener('contextrestored', restoreContext);
      canvas.removeEventListener('pointermove', pointer);
      canvas.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(frame);
      painter.clear();
      frame = 0;
      board = undefined;
      drafts = [];
      marquee = undefined;
      textDraft = undefined;
    };
  }

  function attachMap(canvas: HTMLCanvasElement): () => void {
    map = canvas;
    mappedShapes = undefined;
    function refreshMap(): void {
      mappedShapes = undefined;
      render();
    }

    const observer = new ResizeObserver(refreshMap);
    observer.observe(canvas);
    canvas.addEventListener('contextrestored', refreshMap);

    function recenter(event: PointerEvent): void {
      if (board === undefined) {
        return;
      }

      const position = mapPosition(canvas, scene.shapes(), screenPoint(canvas, event));
      if (position === undefined) {
        return;
      }

      const { width, height } = canvasSize(board);
      setCamera({
        ...camera,
        x: width / 2 - position.x * camera.zoom,
        y: height / 2 - position.y * camera.zoom,
      });
    }

    canvas.addEventListener('pointerdown', recenter);
    render();
    return () => {
      canvas.removeEventListener('pointerdown', recenter);
      canvas.removeEventListener('contextrestored', refreshMap);
      observer.disconnect();
      map = undefined;
      mappedShapes = undefined;
      mappedCamera = undefined;
    };
  }

  function zoom(factor: number): void {
    if (board === undefined) {
      return;
    }

    const { width, height } = canvasSize(board);
    setCamera(zoomCamera(camera, factor, { x: width / 2, y: height / 2 }));
  }

  function previewText(shape?: Shape): void {
    textDraft = shape;
    render();
  }

  function positionText(shape: Shape): InlineTextView | undefined {
    if (board === undefined) {
      return undefined;
    }

    const visible = canvasSize(board);
    const margin = 10;
    const width = Math.min(250, Math.max(0, visible.width - margin * 2));
    const panelHeight = 124;
    const shapeCenter = camera.x + (shape.x + shape.width / 2) * camera.zoom;
    const shapeTop = camera.y + shape.y * camera.zoom;
    const shapeBottom = shapeTop + shape.height * camera.zoom;

    // Place the field near the object and keep the text and keyboard help inside the board.
    const below = shapeBottom + margin;
    const top = below + panelHeight <= visible.height ? below : shapeTop - panelHeight - margin;
    return {
      shape,
      width,
      x: Math.max(margin, Math.min(shapeCenter - width / 2, visible.width - width - margin)),
      y: Math.max(margin, Math.min(top, visible.height - panelHeight - margin)),
    };
  }

  function focusBoard(): void {
    board?.focus({ preventScroll: true });
  }

  function showPeers(next: Peer[]): void {
    const pageId = scene.page();
    const revision = scene.revision();
    const redraw = !sameValue(visibleDrags(peers, pageId, revision), visibleDrags(next, pageId, revision));
    peers = next;
    cursors.show(peers, camera, pageId);
    if (redraw) {
      render();
    }
  }

  function attachCursors(host: HTMLDivElement): () => void {
    const detach = cursors.attach(host);
    cursors.show(peers, camera, scene.page());
    return detach;
  }

  return {
    attachBoard,
    attachMap,
    attachCursors,
    showPeers,
    fit,
    render,
    zoom,
    previewText,
    positionText,
    focusBoard,
    scale: () => camera.zoom,
  };
}
