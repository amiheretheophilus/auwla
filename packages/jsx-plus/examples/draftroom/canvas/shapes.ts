import type { Shape } from '../model/types';

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
  const previous = points.at(-2)!;
  const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
  const length = 9 + shape.weight * 1.2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(end.x - length * Math.cos(angle - 0.52), end.y - length * Math.sin(angle - 0.52));
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(end.x - length * Math.cos(angle + 0.52), end.y - length * Math.sin(angle + 0.52));
  ctx.stroke();
}

function wrappedLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  return text.split('\n').flatMap(paragraph => {
    const lines: string[] = [];
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      const joined = current === '' ? word : `${current} ${word}`;
      if (current !== '' && ctx.measureText(joined).width > width) {
        lines.push(current);
        current = word;
      } else {
        current = joined;
      }
    }
    lines.push(current);
    return lines;
  });
}

function drawText(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (shape.text === '') {
    return;
  }

  const plain = shape.kind === 'text';
  const size = plain ? Math.max(10, shape.weight) : shape.kind === 'note' ? 16 : 19;
  const padding = plain ? 0 : 13;
  const width = Math.max(1, shape.width - padding * 2);
  const lineHeight = size * 1.27;
  ctx.font = `${plain && size < 20 ? 500 : 650} ${size}px "Segoe UI", sans-serif`;
  ctx.textAlign = plain ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = plain ? shape.stroke : '#302842';
  const lines = wrappedLines(ctx, shape.text, width);
  const maxLines = Math.max(1, Math.floor((shape.height - padding) / lineHeight));
  const visible = lines.slice(0, maxLines);

  // Labels start near the top of their boxes. Shape captions are centered as a block.
  const center = shape.height / 2;
  const firstLine = plain ? Math.min(center, size / 2 + 2) : center - (visible.length - 1) * lineHeight / 2;
  const x = plain ? 0 : shape.width / 2;
  visible.forEach((line, index) => {
    ctx.fillText(line, x, firstLine + index * lineHeight, width);
  });
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
  drawText(ctx, shape);
  ctx.restore();
}
