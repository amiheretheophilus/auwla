import type { Bounds, Camera, Shape } from '../model/types';
import { changedBounds, visibleRegion, type PreviewState } from './dirty-region';
import { boundsIntersect } from './geometry';
import { shapeInkBounds } from './shape-bounds';
import { drawShape } from './shapes';
import { surface } from './surface';

const BOARD_PIXEL_BUDGET = 1_600_000;

interface Frame extends PreviewState {
  canvas: HTMLCanvasElement;
  shapes: Shape[];
  camera: Camera;
  width: number;
  height: number;
  density: number;
}

function sameBackground(before: Frame, after: Frame): boolean {
  return before.canvas === after.canvas && before.shapes === after.shapes && before.camera === after.camera
    && before.width === after.width && before.height === after.height && before.density === after.density;
}

function drawSelection(ctx: CanvasRenderingContext2D, shape: Shape, zoom: number, single: boolean): void {
  const gap = 6 / zoom;
  const width = shape.width + gap * 2;
  const height = shape.height + gap * 2;
  ctx.save();
  ctx.translate(shape.x - gap, shape.y - gap);
  ctx.lineWidth = 1.2 / zoom;
  ctx.strokeStyle = shape.locked ? '#8d849a' : '#7857ed';
  ctx.strokeRect(0, 0, width, height);

  if (single && !shape.locked && shape.points === undefined) {
    const size = 7 / zoom;
    ctx.fillStyle = '#fff';
    ctx.fillRect(width - size / 2, height - size / 2, size, size);
    ctx.strokeRect(width - size / 2, height - size / 2, size, size);
  }
  ctx.restore();
}

function drawMarquee(ctx: CanvasRenderingContext2D, area: Bounds, zoom: number): void {
  ctx.save();
  ctx.fillStyle = '#7857ed20';
  ctx.strokeStyle = '#7857ed';
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 3 / zoom]);
  ctx.fillRect(area.x, area.y, area.width, area.height);
  ctx.strokeRect(area.x, area.y, area.width, area.height);
  ctx.restore();
}

/** Keep the previous pixels in the board and repaint the part affected by the preview. */
export function createBoardPainter() {
  let previous: Frame | undefined;
  const ink = new WeakMap<Shape, Bounds | undefined>();

  function inkOf(ctx: CanvasRenderingContext2D, shape: Shape | undefined): Bounds | undefined {
    if (shape === undefined) {
      return undefined;
    }

    // Document edits replace shape objects. Stable layers can reuse their calculated bounds.
    if (!ink.has(shape)) {
      ink.set(shape, shapeInkBounds(ctx, shape));
    }
    return ink.get(shape);
  }

  function paintStack(ctx: CanvasRenderingContext2D, frame: Frame, area?: Bounds): void {
    const { shapes, drafts, outlines, camera, marquee } = frame;
    function draw(shape: Shape): void {
      if (area === undefined) {
        drawShape(ctx, shape);
      } else {
        const bounds = inkOf(ctx, shape);
        if (bounds !== undefined && boundsIntersect(bounds, area)) {
          drawShape(ctx, shape);
        }
      }
    }

    const committedIds = drafts.size === 0 ? undefined : new Set(shapes.map(shape => shape.id));
    const added = committedIds === undefined ? [] : [...drafts.values()].filter(draft => !committedIds.has(draft.id));
    // Frame paper sits behind the objects it encloses, including during its creation preview.
    for (const shape of added) {
      if (shape.kind === 'frame') draw(shape);
    }
    for (const committed of shapes) {
      draw(drafts.get(committed.id) ?? committed);
    }
    for (const shape of added) {
      if (shape.kind !== 'frame') draw(shape);
    }

    for (const outline of outlines) {
      if (!outline.hidden) drawSelection(ctx, outline, camera.zoom, outlines.length === 1);
    }
    if (marquee !== undefined) {
      drawMarquee(ctx, marquee, camera.zoom);
    }
  }

  function paint(
    canvas: HTMLCanvasElement,
    shapes: Shape[],
    camera: Camera,
    selection: Shape[],
    updates: Shape[],
    marquee: Bounds | undefined,
    localDraftId?: string,
  ): void {
    const ctx = surface(canvas, BOARD_PIXEL_BUDGET);
    if (ctx === null) {
      previous = undefined;
      return;
    }

    const density = ctx.getTransform().a;
    const { width, height } = canvas;
    const drafts = new Map(updates.map(shape => [shape.id, shape]));
    const outlines = selection.map(shape => drafts.get(shape.id) ?? shape);
    const localDraft = localDraftId === undefined ? undefined : drafts.get(localDraftId);
    if (outlines.length === 0 && localDraft !== undefined) {
      outlines.push(localDraft);
    }

    const frame: Frame = {
      canvas,
      shapes,
      camera,
      width,
      height,
      density,
      drafts,
      outlines,
      marquee,
    };
    const before = previous;
    previous = frame;

    let region: ReturnType<typeof visibleRegion>;
    const previewing = drafts.size > 0 || marquee !== undefined
      || (before !== undefined && (before.drafts.size > 0 || before.marquee !== undefined));
    if (before !== undefined && previewing && sameBackground(before, frame)) {
      const dirty = changedBounds(before, frame, shapes, camera.zoom, shape => inkOf(ctx, shape));
      region = dirty === undefined ? undefined : visibleRegion(dirty, canvas, camera, density);
      if (region === undefined) {
        return;
      }
    }

    ctx.save();
    ctx.resetTransform();
    if (region === undefined) {
      ctx.clearRect(0, 0, width, height);
    } else {
      const { x, y, width, height } = region.pixels;
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.clearRect(x, y, width, height);
    }

    const scale = density * camera.zoom;
    ctx.setTransform(scale, 0, 0, scale, density * camera.x, density * camera.y);
    paintStack(ctx, frame, region?.world);
    ctx.restore();
  }

  function clear(): void {
    previous = undefined;
  }

  return { paint, clear };
}
