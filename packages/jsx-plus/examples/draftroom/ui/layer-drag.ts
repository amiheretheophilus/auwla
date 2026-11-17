type Side = 'above' | 'below';

interface DropTarget {
  row: HTMLElement;
  side: Side;
}

interface Drag {
  pointer: number;
  source: HTMLElement;
  startY: number;
  active: boolean;
  target?: DropTarget;
}

/** Dragging is a visual preview until release. The document receives one reorder operation. */
export function bindLayerDrag(list: HTMLDivElement, moveLayer: (source: string, target: string, side: Side) => void) {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let drag: Drag | undefined;
  let suppressClick = false;

  function down(event: PointerEvent): void {
    if (drag !== undefined || event.button !== 0 || !(event.target instanceof Element)) {
      return;
    }

    suppressClick = false;
    const row = event.target.closest<HTMLElement>('.layer-item');
    if (row === null || row.dataset.locked === 'yes') {
      return;
    }
    if (event.pointerType === 'touch' && !event.target.closest('.layer-grip')) {
      return;
    }

    drag = { pointer: event.pointerId, source: row, startY: event.clientY, active: false };
  }

  function mark(active: Drag, target?: DropTarget): void {
    if (active.target?.row === target?.row && active.target?.side === target?.side) {
      return;
    }

    active.target?.row.removeAttribute('data-drop-side');
    active.target = target;
    if (target !== undefined) {
      target.row.dataset.dropSide = target.side;
    }
  }

  function findTarget(event: PointerEvent, source: HTMLElement): DropTarget | undefined {
    // Captured pointer events target the list. Hit-test the visible row under the pointer instead.
    const underPointer = list.ownerDocument.elementFromPoint(event.clientX, event.clientY);
    const row = underPointer?.closest<HTMLElement>('.layer-item');
    if (!row || row === source || !list.contains(row)) {
      return undefined;
    }

    const bounds = row.getBoundingClientRect();
    const side = event.clientY < bounds.top + bounds.height / 2 ? 'above' : 'below';
    return { row, side };
  }

  function preview(event: PointerEvent): void {
    const active = drag;
    if (active === undefined || active.pointer !== event.pointerId) {
      return;
    }

    if (!active.active) {
      if (Math.abs(event.clientY - active.startY) < 5) {
        return;
      }

      active.active = true;
      active.source.dataset.dragging = 'yes';
      list.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    mark(active, findTarget(event, active.source));
  }

  function finish(event: PointerEvent, commit: boolean): void {
    const active = drag;
    if (active === undefined || active.pointer !== event.pointerId) {
      return;
    }

    drag = undefined;
    suppressClick = active.active;
    active.source.removeAttribute('data-dragging');
    mark(active);
    if (!commit || !active.active) {
      return;
    }

    const target = findTarget(event, active.source);
    const sourceId = active.source.dataset.layerId;
    const targetId = target?.row.dataset.layerId;
    if (sourceId !== undefined && targetId !== undefined && target !== undefined) {
      moveLayer(sourceId, targetId, target.side);
    }
  }

  function interceptClick(event: MouseEvent): void {
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  list.addEventListener('pointerdown', down, options);
  list.addEventListener('click', interceptClick, { ...options, capture: true });
  window.addEventListener('pointermove', preview, { ...options, passive: false });
  window.addEventListener('pointerup', event => finish(event, true), options);
  window.addEventListener('pointercancel', event => finish(event, false), options);
  list.addEventListener('lostpointercapture', event => {
    // Touch starts with implicit capture on the grip. Moving capture to the list is expected.
    if (event.target === list) {
      finish(event, false);
    }
  }, options);
  return () => listeners.abort();
}
