import { createViewport } from './canvas/viewport';
import { bindClipboard } from './clipboard';
import { createFrameActions } from './frame-actions';
import { createDocument } from './model/document';
import { initialProject } from './model/templates';
import type { EditorView, Shape, Tool } from './model/types';
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
    selection: project.selection,
    movable: project.movable,
    tool: () => tool,
    snap: () => snap,
    select: project.select,
    selectMany: project.selectMany,
    editText(id) {
      textEditing.open(id);
    },
    finish(shapes) {
      const shape = shapes[0]!;
      const added = shapes.length === 1 && project.shapeById(shape.id) === undefined;
      tool = 'select';
      if (added) {
        project.put(shape);
      } else {
        project.apply(shapes);
      }

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
  const frames = createFrameActions(project.page, say, publish);

  function view(): EditorView {
    return {
      pages: project.project().pages,
      page: project.page(),
      selected: project.selected(),
      selection: project.selection(),
      inlineText: textEditing.view(),
      presentation: frames.presentation(),
      shareUrl: frames.link(),
      shareFrameId: frames.linkFrame(),
      sharing: frames.sharing(),
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
    project.nudge({ x, y });
  }

  function focusFrame(frame: Shape): void {
    project.select(frame.id);
    viewport.fit(frame);
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
      group: project.group,
      ungroup: project.ungroup,
      remove: project.remove,
      nudge,
      editText: textEditing.open,
      zoom: viewport.zoom,
      fit: viewport.fit,
    });
    const unbindClipboard = bindClipboard(project.copySelection, project.paste);

    let connected = true;
    files.restore(() => connected);

    return () => {
      connected = false;
      disconnect();
      unbind();
      unbindClipboard();
      frames.close();
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
    frames,
    focusFrame,
    text: textEditing,
    focusBoard: viewport.focusBoard,
    fit: () => viewport.fit(),
    zoom: viewport.zoom,
    attachMap: viewport.attachMap,
    toggleGrid,
    toggleSnap,
  };
}

export type Editor = ReturnType<typeof createEditor>;
