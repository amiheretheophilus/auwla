import { decodeClipboard } from './model/files';
import type { Shape } from './model/types';

const PREFIX = 'Draftroom selection\n';

function isEditing(event: ClipboardEvent): boolean {
  return event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]') !== null;
}

/** A text clipboard format works between tabs and keeps ordinary text editing native. */
export function bindClipboard(selection: () => Shape[], paste: (shapes: Shape[]) => void): () => void {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };

  function copy(event: ClipboardEvent): void {
    if (isEditing(event) || event.clipboardData === null) {
      return;
    }

    const shapes = selection();
    if (shapes.length > 0) {
      event.clipboardData.setData('text/plain', PREFIX + JSON.stringify(shapes));
      event.preventDefault();
    }
  }

  function insert(event: ClipboardEvent): void {
    if (isEditing(event) || event.clipboardData === null) {
      return;
    }

    const text = event.clipboardData.getData('text/plain');
    if (!text.startsWith(PREFIX) || text.length > 2_000_000) {
      return;
    }

    event.preventDefault();
    Promise.resolve().then(() => decodeClipboard(text.slice(PREFIX.length))).then(shapes => {
      if (shapes !== undefined && !listeners.signal.aborted) {
        paste(shapes);
      }
    }, () => undefined);
  }

  window.addEventListener('copy', copy, options);
  window.addEventListener('paste', insert, options);
  return () => listeners.abort();
}
