import type { Bounds, Shape } from '../model/types';
import { unionBounds } from './geometry';

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

function layoutText(ctx: CanvasRenderingContext2D, shape: Shape) {
  const plain = shape.kind === 'text';
  const size = plain ? Math.max(10, shape.weight) : shape.kind === 'note' ? 16 : 19;
  const padding = plain ? 0 : 13;
  const width = Math.max(1, shape.width - padding * 2);
  const lineHeight = size * 1.27;
  ctx.font = `${plain && size < 20 ? 500 : 650} ${size}px "Segoe UI", sans-serif`;
  ctx.textAlign = plain ? 'left' : 'center';
  ctx.textBaseline = 'middle';

  const lines = wrappedLines(ctx, shape.text, width);
  const lineLimit = Math.max(1, Math.floor((shape.height - padding) / lineHeight));
  const visible = lines.slice(0, lineLimit);

  // Labels start near the top of their boxes. Shape captions are centered as a block.
  const center = shape.height / 2;
  const firstLine = plain ? Math.min(center, size / 2 + 2) : center - (visible.length - 1) * lineHeight / 2;
  return { x: plain ? 0 : shape.width / 2, firstLine, lineHeight, width, lines: visible };
}

export function drawShapeText(ctx: CanvasRenderingContext2D, shape: Shape): void {
  if (shape.text === '') {
    return;
  }

  const layout = layoutText(ctx, shape);
  ctx.fillStyle = shape.kind === 'text' ? shape.stroke : '#302842';
  layout.lines.forEach((line, index) => {
    ctx.fillText(line, layout.x, layout.firstLine + index * layout.lineHeight, layout.width);
  });
}

export function textInkBounds(ctx: CanvasRenderingContext2D, shape: Shape): Bounds | undefined {
  if (shape.text === '') {
    return undefined;
  }

  ctx.save();
  const layout = layoutText(ctx, shape);
  let bounds: Bounds | undefined;

  for (const [index, line] of layout.lines.entries()) {
    const ink = ctx.measureText(line);
    const y = shape.y + layout.firstLine + index * layout.lineHeight;
    // Use the uncondensed bounds. fillText's maxWidth can shrink a line, so this is conservative.
    bounds = unionBounds(bounds, {
      x: shape.x + layout.x - ink.actualBoundingBoxLeft,
      y: y - ink.actualBoundingBoxAscent,
      width: ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight,
      height: ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent,
    });
  }

  ctx.restore();
  return bounds;
}
