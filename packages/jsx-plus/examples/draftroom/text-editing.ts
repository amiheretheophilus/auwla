import type { createDocument } from './model/document';
import { canEditText, type InlineTextView, type Shape } from './model/types';

interface TextSurface {
  previewText(shape?: Shape): void;
  positionText(shape: Shape): InlineTextView | undefined;
}

/** Both text fields preview on input and commit one edit when the field closes. */
export function createTextEditing(project: ReturnType<typeof createDocument>, surface: TextSurface, publish: () => void) {
  let inlineId: string | undefined;
  let previewId: string | undefined;

  function open(id = project.selected()?.id): boolean {
    const shape = project.shapeById(id);
    if (!canEditText(shape) || shape.hidden) {
      return false;
    }

    project.selectOnly(shape.id);
    inlineId = shape.id;
    publish();
    return true;
  }

  function preview(id: string, text: string): void {
    const shape = project.selected();
    if (!canEditText(shape) || shape.id !== id) {
      return;
    }

    previewId = id;
    surface.previewText({ ...shape, text });
  }

  function clearPreview(): void {
    if (previewId !== undefined) {
      previewId = undefined;
      surface.previewText();
    }
  }

  function finish(id: string, text?: string): void {
    const wasInline = inlineId === id;
    if (wasInline) {
      inlineId = undefined;
    }
    if (previewId === id) {
      clearPreview();
    }

    const committed = text !== undefined && project.setText(id, text);
    if (wasInline && !committed) {
      publish();
    }
  }

  function syncSelection(): void {
    const selectedId = project.selected()?.id;
    if (inlineId !== selectedId) {
      inlineId = undefined;
    }
    if (previewId !== selectedId) {
      clearPreview();
    }
  }

  function view(): InlineTextView | undefined {
    const shape = project.shapeById(inlineId);
    return shape === undefined ? undefined : surface.positionText(shape);
  }

  return { open, preview, finish, syncSelection, view, isOpen: () => inlineId !== undefined };
}
