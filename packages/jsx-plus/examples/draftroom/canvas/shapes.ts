import type { Shape } from '../model/types';
import { FRAME_HEADER } from '../model/frames';
import { arrowHead } from './geometry';
import { drawShapeText } from './shape-text';

function drawFrame(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.fillStyle = shape.fill === 'transparent' ? '#faf8fe' : shape.fill;
  ctx.fillRect(0, 0, shape.width, shape.height);
  ctx.strokeStyle = shape.stroke;
  ctx.strokeRect(0, 0, shape.width, shape.height);

  if (shape.width > 22 && shape.height >= FRAME_HEADER) {
    ctx.fillStyle = '#eee7fb';
    ctx.fillRect(0, 0, shape.width, FRAME_HEADER);
    ctx.fillStyle = '#4d397a';
    ctx.font = '650 14px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(shape.title, 10, FRAME_HEADER / 2, shape.width - 20);
  }
}

function traceShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const { width, height } = shape;
  if (shape.kind === 'ellipse') {
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else if (shape.kind === 'diamond') {
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width, height / 2);
    ctx.lineTo(width / 2, height);
    ctx.lineTo(0, height / 2);
    ctx.closePath();
  } else {
    ctx.roundRect(0, 0, width, height, shape.kind === 'note' ? 4 : 14);
  }
}

function drawPath(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const points = shape.points;
  if (points === undefined || points.length < 2) {
    return;
  }

  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  if (shape.kind !== 'arrow') {
    return;
  }

  const end = points.at(-1)!;
  const [first, last] = arrowHead(end, points.at(-2)!, shape.weight);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (shape.hidden) {
    return;
  }

  ctx.save();
  ctx.translate(shape.x, shape.y);
  ctx.globalAlpha = shape.opacity;
  ctx.strokeStyle = shape.stroke;
  ctx.lineWidth = shape.weight;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (shape.kind === 'frame') {
    drawFrame(ctx, shape);
    ctx.restore();
    return;
  }
  if (shape.line === 'dashed') {
    ctx.setLineDash([shape.weight * 4, shape.weight * 3]);
  } else if (shape.line === 'dotted') {
    ctx.setLineDash([1, shape.weight * 2.5]);
  }

  ctx.beginPath();
  if (shape.kind === 'arrow' || shape.kind === 'pen') {
    drawPath(ctx, shape);
  } else if (shape.kind !== 'text') {
    traceShape(ctx, shape);
    if (shape.fill !== 'transparent') {
      ctx.fillStyle = shape.fill;
      ctx.fill();
    }
    ctx.stroke();
  }
  drawShapeText(ctx, shape);
  ctx.restore();
}
