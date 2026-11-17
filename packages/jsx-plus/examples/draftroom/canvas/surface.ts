export function canvasSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  return { width: canvas.clientWidth, height: canvas.clientHeight };
}

export function surface(canvas: HTMLCanvasElement, pixelBudget = Infinity): CanvasRenderingContext2D | null {
  const { width, height } = canvasSize(canvas);
  const deviceDensity = Math.min(2, window.devicePixelRatio || 1);
  // Limit high-DPI oversampling and keep at least one backing pixel per CSS pixel where available.
  const budgetDensity = Math.max(1, Math.sqrt(pixelBudget / Math.max(1, width * height)));
  const density = Math.min(deviceDensity, budgetDensity);
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
