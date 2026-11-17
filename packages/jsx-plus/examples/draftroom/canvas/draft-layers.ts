import type { Camera, Shape } from '../model/types';
import { drawShape } from './shapes';

interface DraftLayers {
  below?: HTMLCanvasElement;
  above?: HTMLCanvasElement;
}

interface CachedLayers {
  shapes: Shape[];
  camera: Camera;
  draftId: string;
  width: number;
  height: number;
  density: number;
  layers: DraftLayers;
}

function releaseLayer(layer?: HTMLCanvasElement): void {
  if (layer !== undefined) {
    // Empty the backing store immediately, even if the browser has yet to collect the element.
    layer.width = 0;
    layer.height = 0;
  }
}

function captureLayer(
  board: HTMLCanvasElement,
  shapes: Shape[],
  start: number,
  end: number,
  camera: Camera,
  density: number,
): HTMLCanvasElement | undefined {
  if (start >= end) {
    return undefined;
  }

  const layer = board.ownerDocument.createElement('canvas');
  layer.width = board.width;
  layer.height = board.height;

  const context = layer.getContext('2d');
  if (context === null) {
    return undefined;
  }

  const scale = camera.zoom * density;
  context.setTransform(scale, 0, 0, scale, camera.x * density, camera.y * density);
  for (let index = start; index < end; index += 1) {
    drawShape(context, shapes[index]!);
  }
  return layer;
}

/** Keep the unchanged drawing in two layers so a moving object keeps its place in the stack. */
export function createDraftLayerCache() {
  let cached: CachedLayers | undefined;

  function get(board: HTMLCanvasElement, shapes: Shape[], camera: Camera, draftId: string, density: number): DraftLayers {
    const { width, height } = board;
    if (cached !== undefined && cached.shapes === shapes && cached.camera === camera
      && cached.draftId === draftId && cached.width === width && cached.height === height && cached.density === density) {
      return cached.layers;
    }

    clear();

    // A new object goes on top. An existing one divides the scene at its original index.
    const index = shapes.findIndex(shape => shape.id === draftId);
    const layers = index < 0
      ? { below: captureLayer(board, shapes, 0, shapes.length, camera, density) }
      : {
        below: captureLayer(board, shapes, 0, index, camera, density),
        above: captureLayer(board, shapes, index + 1, shapes.length, camera, density),
      };

    cached = { shapes, camera, draftId, width, height, density, layers };
    return layers;
  }

  function clear(): void {
    const layers = cached?.layers;
    cached = undefined;
    if (layers !== undefined) {
      releaseLayer(layers.below);
      releaseLayer(layers.above);
    }
  }

  return { get, clear };
}
