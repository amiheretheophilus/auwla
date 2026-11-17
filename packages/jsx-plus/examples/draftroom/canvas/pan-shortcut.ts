function isSpace(event: KeyboardEvent): boolean {
  return event.code === 'Space' || event.key === ' ';
}

export function bindPanShortcut(canvas: HTMLCanvasElement, signal: AbortSignal, onHold: () => void) {
  let held = false;
  let dragging = false;
  let usedForDrag = false;

  function updateCursor(): void {
    canvas.dataset.spacePan = dragging ? 'dragging' : held ? 'ready' : 'off';
  }

  function down(event: KeyboardEvent): void {
    if (!isSpace(event) || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : undefined;
    if (target?.closest('input, textarea, select, [contenteditable]')) {
      return;
    }

    if (!held) {
      held = true;
      onHold();
      updateCursor();
    }

    // Record Space on a focused toolbar button, but preserve its keyboard activation for a tap.
    if (!target?.closest('button, summary, [role="button"]') || usedForDrag) {
      event.preventDefault();
    }
  }

  function up(event: KeyboardEvent): void {
    if (!isSpace(event)) {
      return;
    }

    if (usedForDrag) {
      event.preventDefault();
    }
    usedForDrag = false;
    held = false;
    updateCursor();
  }

  function reset(): void {
    held = false;
    dragging = false;
    usedForDrag = false;
    updateCursor();
  }

  function begin(): void {
    if (held) {
      dragging = true;
      usedForDrag = true;
      updateCursor();
    }
  }

  function end(): void {
    if (dragging) {
      dragging = false;
      updateCursor();
    }
  }

  window.addEventListener('keydown', down, { signal });
  window.addEventListener('keyup', up, { signal });
  window.addEventListener('blur', reset, { signal });
  signal.addEventListener('abort', reset, { once: true });
  return { held: () => held, begin, end };
}
