import { drawingBounds, fitCamera, GRID, zoomCamera } from './geometry';
import { bindGestures, screenPoint } from './gestures';
import { canvasSize, createBoardPainter, mapPosition, paintMap } from './paint';
import type { Camera, Shape, Tool } from '../model/types';

interface Scene {
  shapes(): Shape[];
  selected(): Shape | undefined;
  tool(): Tool;
  snap(): boolean;
  select(id?: string): void;
  finish(shape: Shape): void;
  changed(): void;
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
  let board: HTMLCanvasElement | undefined;
  let map: HTMLCanvasElement | undefined;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let draft: Shape | undefined;
  let frame = 0;
  let fitted = false;
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
      painter.paint(board, shapes, camera, scene.selected(), draft);
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
    if (zoomChanged) {
      scene.changed();
    }
    render();
  }

  function fit(): void {
    if (board === undefined) {
      return;
    }

    const { width, height } = canvasSize(board);
    if (width === 0 || height === 0) {
      return;
    }
    fitted = true;
    setCamera(fitCamera(drawingBounds(scene.shapes()), width, height));
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
      select: scene.select,
      finish: scene.finish,
      preview(shape) {
        draft = shape;
        render();
      },
    });

    const observer = new ResizeObserver(() => {
      // The viewport outline in the minimap also depends on the visible canvas size.
      mappedCamera = undefined;
      if (!fitted) {
        fit();
      }
      render();
    });
    observer.observe(canvas);

    return () => {
      detach();
      observer.disconnect();
      cancelAnimationFrame(frame);
      painter.clear();
      frame = 0;
      board = undefined;
      draft = undefined;
    };
  }

  function attachMap(canvas: HTMLCanvasElement): () => void {
    map = canvas;
    mappedShapes = undefined;
    const observer = new ResizeObserver(() => {
      mappedShapes = undefined;
      render();
    });
    observer.observe(canvas);

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

  return {
    attachBoard,
    attachMap,
    fit,
    render,
    zoom,
    scale: () => camera.zoom,
  };
}
