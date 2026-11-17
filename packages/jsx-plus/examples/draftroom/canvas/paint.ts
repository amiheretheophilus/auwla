import { drawingBounds, GRID, toWorld } from './geometry';
import { drawShape } from './shapes';
import type { Camera, Point, Shape } from '../model/types';

export function canvasSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  return { width: canvas.clientWidth, height: canvas.clientHeight };
}

function surface(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const { width, height } = canvasSize(canvas);
  const density = Math.min(2, window.devicePixelRatio || 1);
  const pixelsWide = Math.round(width * density);
  const pixelsHigh = Math.round(height * density);

  if (canvas.width !== pixelsWide) {
    canvas.width = pixelsWide;
  }
  if (canvas.height !== pixelsHigh) {
    canvas.height = pixelsHigh;
  }

  const ctx = canvas.getContext('2d');
  ctx?.setTransform(density, 0, 0, density, 0, 0);
  return ctx;
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, camera: Camera): void {
  const step = GRID * camera.zoom * (camera.zoom < 0.35 ? 4 : 1);
  const startX = (camera.x % step + step) % step;
  const startY = (camera.y % step + step) % step;
  ctx.fillStyle = '#cec8db';
  ctx.beginPath();
  for (let x = startX; x < width; x += step) {
    for (let y = startY; y < height; y += step) {
      ctx.moveTo(x + 1, y);
      ctx.arc(x, y, 0.83, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function drawSelection(ctx: CanvasRenderingContext2D, shape: Shape, zoom: number): void {
  const gap = 6 / zoom;
  const width = shape.width + gap * 2;
  const height = shape.height + gap * 2;
  ctx.save();
  ctx.translate(shape.x - gap, shape.y - gap);
  ctx.lineWidth = 1.2 / zoom;
  ctx.strokeStyle = shape.locked ? '#8d849a' : '#7857ed';
  ctx.strokeRect(0, 0, width, height);

  if (!shape.locked && shape.points === undefined) {
    const size = 7 / zoom;
    ctx.fillStyle = '#fff';
    ctx.fillRect(width - size / 2, height - size / 2, size, size);
    ctx.strokeRect(width - size / 2, height - size / 2, size, size);
  }
  ctx.restore();
}

export function paintBoard(
  canvas: HTMLCanvasElement,
  shapes: Shape[],
  camera: Camera,
  grid: boolean,
  selectedId?: string,
): void {
  const ctx = surface(canvas);
  if (ctx === null) {
    return;
  }

  const { width, height } = canvasSize(canvas);
  ctx.clearRect(0, 0, width, height);
  if (grid) {
    drawGrid(ctx, width, height, camera);
  }

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  for (const shape of shapes) {
    drawShape(ctx, shape);
  }

  const selected = shapes.find(shape => shape.id === selectedId && !shape.hidden);
  if (selected !== undefined) {
    drawSelection(ctx, selected, camera.zoom);
  }
  ctx.restore();
}

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

export function imageOf(shapes: Shape[]): HTMLCanvasElement | undefined {
  const bounds = drawingBounds(shapes);
  if (bounds === undefined) {
    return undefined;
  }

  const canvas = document.createElement('canvas');
  const padding = 30;
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
