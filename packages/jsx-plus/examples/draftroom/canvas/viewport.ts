import { drawingBounds, fitCamera, zoomCamera } from './geometry';
import { bindGestures, screenPoint } from './gestures';
import { canvasSize, mapPosition, paintBoard, paintMap } from './paint';
import type { Camera, Shape, Tool } from '../model/types';

interface Scene {
  shapes(): Shape[];
  selected(): Shape | undefined;
  tool(): Tool;
  grid(): boolean;
  snap(): boolean;
  select(id?: string): void;
  finish(shape: Shape): void;
  changed(): void;
}

export function createViewport(scene: Scene) {
  let board: HTMLCanvasElement | undefined;
  let map: HTMLCanvasElement | undefined;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let draft: Shape | undefined;
  let frame = 0;
  let fitted = false;

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
      const preview = draft;
      let painting = shapes;
      if (preview !== undefined) {
        const exists = shapes.some(shape => shape.id === preview.id);
        // Preserve the original stacking order while moving or resizing a layer.
        painting = exists ? shapes.map(shape => shape.id === preview.id ? preview : shape) : [...shapes, preview];
      }

      paintBoard(board, painting, camera, scene.grid(), preview?.id ?? scene.selected()?.id);
      if (map !== undefined) {
        paintMap(map, board, painting, camera);
      }
    });
  }

  function setCamera(next: Camera): void {
    const zoomChanged = Math.round(camera.zoom * 100) !== Math.round(next.zoom * 100);
    camera = next;
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
      frame = 0;
      board = undefined;
      draft = undefined;
    };
  }

  function attachMap(canvas: HTMLCanvasElement): () => void {
    map = canvas;
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
      map = undefined;
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
