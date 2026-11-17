import { createViewport } from './canvas/viewport';
import { createDocument } from './model/document';
import { initialProject } from './model/templates';
import type { EditorView, Tool } from './model/types';
import { createProjectFiles } from './project-files';
import { bindShortcuts } from './shortcuts';
import { createTextEditing } from './text-editing';

/** Connects the document, canvas, and JSX+ controls. Canvas previews never publish a UI snapshot. */
export function createEditor(update: (view: EditorView) => void) {
  let tool: Tool = 'select';
  let grid = true;
  let snap = false;
  let notice = 'Local workspace';

  const project = createDocument(initialProject(), changed);
  const viewport = createViewport({
    shapes: () => project.page().shapes,
    selected: project.selected,
    tool: () => tool,
    snap: () => snap,
    select: project.select,
    editText(id) {
      textEditing.open(id);
    },
    finish(shape) {
      const added = project.shapeById(shape.id) === undefined;
      tool = 'select';
      project.put(shape);

      if (added && (shape.kind === 'text' || shape.kind === 'note')) {
        textEditing.open(shape.id);
      }
    },
    changed(zoomChanged) {
      if (zoomChanged || textEditing.isOpen()) {
        publish();
      }
    },
  });
  const files = createProjectFiles(project, say);
  const textEditing = createTextEditing(project, viewport, publish);

  function view(): EditorView {
    return {
      pages: project.project().pages,
      page: project.page(),
      selected: project.selected(),
      inlineText: textEditing.view(),
      tool,
      grid,
      snap,
      zoom: Math.round(viewport.scale() * 100),
      canUndo: project.canUndo(),
      canRedo: project.canRedo(),
      notice,
    };
  }

  function publish(): void {
    update(view());
  }

  function say(message: string): void {
    notice = message;
    publish();
  }

  function changed(persist: boolean, refit: boolean): void {
    textEditing.syncSelection();

    if (refit) {
      viewport.fit();
    }

    if (persist) {
      notice = 'Saving…';
      files.save();
    }

    viewport.render();
    publish();
  }

  function choose(value: Tool): void {
    tool = value;
    if (value !== 'select' && value !== 'hand') {
      project.select();
    }
    publish();
  }

  function nudge(x: number, y: number): void {
    const shape = project.selected();
    if (shape !== undefined) {
      project.patch({ x: shape.x + x, y: shape.y + y });
    }
  }

  const undo = () => project.travel('undo');
  const redo = () => project.travel('redo');

  function connect(canvas: HTMLCanvasElement): () => void {
    const disconnect = viewport.attachBoard(canvas);
    const unbind = bindShortcuts({
      choose,
      select: project.select,
      undo,
      redo,
      duplicate: project.duplicate,
      remove: project.remove,
      nudge,
      editText: textEditing.open,
      zoom: viewport.zoom,
      fit: viewport.fit,
    });

    let connected = true;
    files.restore(() => connected);

    return () => {
      connected = false;
      disconnect();
      unbind();
    };
  }

  function toggleGrid(): void {
    grid = !grid;
    publish();
  }

  function toggleSnap(): void {
    snap = !snap;
    publish();
  }

  return {
    view,
    connect,
    choose,
    undo,
    redo,
    importFile: files.importFile,
    exportProject: files.exportProject,
    exportPng: files.exportPng,
    project,
    text: textEditing,
    focusBoard: viewport.focusBoard,
    fit: viewport.fit,
    zoom: viewport.zoom,
    attachMap: viewport.attachMap,
    toggleGrid,
    toggleSnap,
  };
}

export type Editor = ReturnType<typeof createEditor>;
