import { drawingBounds, toWorld } from './geometry';
import { drawShape } from './shapes';
import { canvasSize, surface } from './surface';
import type { Bounds, Camera, Point, Shape } from '../model/types';

function mapCamera(map: HTMLCanvasElement, shapes: Shape[]): Camera | undefined {
  const bounds = drawingBounds(shapes);
  if (bounds === undefined) {
    return undefined;
  }

  const { width, height } = canvasSize(map);
  const zoom = Math.min((width - 16) / Math.max(1, bounds.width), (height - 16) / Math.max(1, bounds.height));
  if (zoom <= 0) {
    return undefined;
  }

  return {
    zoom,
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

export function paintMap(map: HTMLCanvasElement, board: HTMLCanvasElement, shapes: Shape[], view: Camera): void {
  const ctx = surface(map);
  if (ctx === null) {
    return;
  }

  const { width, height } = canvasSize(map);
  ctx.clearRect(0, 0, width, height);
  const camera = mapCamera(map, shapes);
  if (camera === undefined) {
    return;
  }

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  for (const shape of shapes) {
    drawShape(ctx, shape);
  }

  const topLeft = toWorld({ x: 0, y: 0 }, view);
  const size = canvasSize(board);
  ctx.lineWidth = 1 / camera.zoom;
  ctx.strokeStyle = '#9478ed';
  ctx.strokeRect(topLeft.x, topLeft.y, size.width / view.zoom, size.height / view.zoom);
  ctx.restore();
}

export function mapPosition(map: HTMLCanvasElement, shapes: Shape[], point: Point): Point | undefined {
  const camera = mapCamera(map, shapes);
  return camera === undefined ? undefined : toWorld(point, camera);
}

export function imageOf(shapes: Shape[], crop?: Bounds): HTMLCanvasElement | undefined {
  const bounds = crop ?? drawingBounds(shapes);
  if (bounds === undefined) {
    return undefined;
  }

  const canvas = document.createElement('canvas');
  const padding = crop === undefined ? 30 : 0;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;
  // Keep oversized boards exportable without allocating an unbounded bitmap.
  const scale = Math.min(2, 4096 / Math.max(width, height));
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return undefined;
  }

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-bounds.x + padding, -bounds.y + padding);
  for (const shape of shapes) {
    drawShape(ctx, shape);
  }
  return canvas;
}
