import { prepareShapes, replaceShapes } from './edits';
import { createHistory } from './history';
import { alignShapes, cloneSelection, groupMembers, movableShapes, translated, type Alignment } from './selection';
import { templatePage, type Template } from './templates';
import { canEditText, makePage, type Page, type Point, type Project, type Shape } from './types';

export function createDocument(initial: Project, change: (persist: boolean, refit: boolean) => void) {
  const history = createHistory(initial);
  let selectedIds: string[] = [];

  function page(): Page {
    const project = history.current();
    return project.pages.find(item => item.id === project.activeId) ?? project.pages[0]!;
  }

  function selected(): Shape | undefined {
    return selectedIds.length === 1 ? shapeById(selectedIds[0]) : undefined;
  }

  function selection(): Shape[] {
    return page().shapes.filter(shape => selectedIds.includes(shape.id));
  }

  function shapeById(id: string | undefined): Shape | undefined {
    return page().shapes.find(shape => shape.id === id);
  }

  function selectMany(ids: string[], extend = false): void {
    const combined = extend ? [...selectedIds, ...ids] : ids;
    const next = groupMembers(page().shapes, combined);
    if (selectedIds.length === next.length && selectedIds.every((id, index) => id === next[index])) {
      return;
    }
    selectedIds = next;
    change(false, false);
  }

  function select(id?: string, toggle = false): void {
    if (id !== undefined && toggle) {
      const ids = groupMembers(page().shapes, [id]);
      if (selectedIds.includes(id)) {
        selectMany(selectedIds.filter(current => !ids.includes(current)));
      } else {
        selectMany(ids, true);
      }
    } else {
      selectMany(id === undefined ? [] : [id]);
    }
  }

  function selectOnly(id: string): void {
    if (selectedIds.length !== 1 || selectedIds[0] !== id) {
      selectedIds = [id];
      change(false, false);
    }
  }

  function setPage(next: Page): void {
    const project = history.current();
    const prepared = { ...next, shapes: prepareShapes(next.shapes) };
    const pages = project.pages.map(item => item.id === next.id ? prepared : item);
    history.commit({ ...project, pages });
    change(true, false);
  }

  function open(id: string): void {
    const project = history.current();
    if (project.activeId === id || !project.pages.some(item => item.id === id)) {
      return;
    }
    selectedIds = [];
    history.navigate(id);
    change(true, true);
  }

  function add(template?: Template): void {
    const project = history.current();
    const next = template === undefined ? makePage(`Untitled board ${project.pages.length + 1}`) : templatePage(template);

    selectedIds = [];
    history.commit({ ...project, activeId: next.id, pages: [...project.pages, next] });
    change(true, true);
  }

  function rename(name: string): void {
    const current = page();
    const trimmed = name.trim();
    if (trimmed && trimmed !== current.name) {
      setPage({ ...current, name: trimmed });
    }
  }

  function removePage(): void {
    const project = history.current();
    if (project.pages.length === 1) {
      return;
    }

    const pages = project.pages.filter(item => item.id !== project.activeId);
    selectedIds = [];
    history.commit({ ...project, activeId: pages[0]!.id, pages });
    change(true, true);
  }

  function put(shape: Shape): void {
    selectedIds = groupMembers(page().shapes, [shape.id]);
    if (selectedIds.length === 0) {
      selectedIds = [shape.id];
    }
    apply([shape]);
  }

  function apply(changes: Shape[]): void {
    if (changes.length === 0) {
      return;
    }

    const current = page();
    setPage({ ...current, shapes: replaceShapes(current.shapes, changes) });
  }

  function patch(values: Partial<Shape>): void {
    const shape = selected();
    if (shape === undefined) {
      return;
    }
    if (shape.locked && values.locked === undefined && values.hidden === undefined) {
      return;
    }
    put({ ...shape, ...values });
  }

  function setText(id: string, text: string): boolean {
    const shape = shapeById(id);
    if (!canEditText(shape) || shape.text === text) {
      return false;
    }

    const current = page();
    const shapes = current.shapes.map(item => item === shape ? { ...shape, text } : item);
    setPage({ ...current, shapes });
    return true;
  }

  function duplicate(): void {
    const shapes = copySelection();
    if (shapes.length > 0) {
      paste(shapes);
    }
  }

  function movable(): Shape[] {
    return movableShapes(page().shapes, selectedIds);
  }

  function copySelection(): Shape[] {
    const ids = new Set(movable().map(shape => shape.id));
    // Preserve an internal connection when both of its endpoints are copied.
    return page().shapes.filter(shape => ids.has(shape.id)
      || (shape.kind === 'arrow' && ids.has(shape.fromId ?? '') && ids.has(shape.toId ?? '')));
  }

  function paste(shapes: Shape[]): void {
    const copies = cloneSelection(shapes, { x: 24, y: 24 });
    selectedIds = copies.map(shape => shape.id);
    apply(copies);
  }

  function nudge(offset: Point): void {
    apply(translated(movable(), offset));
  }

  function group(): void {
    const targets = selection().filter(shape => shape.kind !== 'frame' && !shape.locked);
    if (targets.length >= 2) {
      const groupId = crypto.randomUUID();
      apply(targets.map(shape => ({ ...shape, groupId })));
    }
  }

  function ungroup(): void {
    apply(selection().filter(shape => shape.groupId !== undefined && !shape.locked)
      .map(shape => ({ ...shape, groupId: undefined })));
  }

  function align(alignment: Alignment): void {
    const targets = selection().filter(shape => shape.kind !== 'frame' && !shape.locked);
    const minimum = alignment === 'horizontal' || alignment === 'vertical' ? 3 : 2;
    if (targets.length >= minimum) {
      apply(alignShapes(targets, alignment));
    }
  }

  function remove(): void {
    const ids = new Set(selection().filter(shape => !shape.locked).map(shape => shape.id));
    if (ids.size === 0) {
      return;
    }
    const current = page();
    selectedIds = [];
    setPage({ ...current, shapes: current.shapes.filter(item => !ids.has(item.id)) });
  }

  function reorder(offset: number): void {
    const shape = selected();
    if (shape === undefined || shape.locked) {
      return;
    }

    const current = page();
    const index = current.shapes.indexOf(shape);
    const destination = index + offset;
    if (destination < 0 || destination >= current.shapes.length) {
      return;
    }

    if ((shape.kind === 'frame') !== (current.shapes[destination]?.kind === 'frame')) {
      return;
    }

    const shapes = current.shapes.slice();
    shapes[index] = shapes[destination]!;
    shapes[destination] = shape;
    setPage({ ...current, shapes });
  }

  function moveLayer(sourceId: string, targetId: string, side: 'above' | 'below'): void {
    const current = page();
    const from = current.shapes.findIndex(shape => shape.id === sourceId);
    const target = current.shapes.findIndex(shape => shape.id === targetId);
    const moving = current.shapes[from];
    if (moving === undefined || moving.locked || target < 0 || from === target) {
      return;
    }

    if ((moving.kind === 'frame') !== (current.shapes[target]?.kind === 'frame')) {
      return;
    }

    // Drawing order is back to front. The Layers list displays that order in reverse.
    const targetAfterRemoval = from < target ? target - 1 : target;
    const destination = targetAfterRemoval + (side === 'above' ? 1 : 0);
    if (destination === from) {
      return;
    }

    const shapes = current.shapes.slice();
    shapes.splice(from, 1);
    shapes.splice(destination, 0, moving);
    setPage({ ...current, shapes });
  }

  function travel(direction: 'undo' | 'redo'): void {
    const before = history.current();
    history[direction]();
    const after = history.current();
    if (before !== after) {
      selectedIds = groupMembers(page().shapes, selectedIds);
      change(true, before.activeId !== after.activeId);
    }
  }

  function replace(project: Project, persist: boolean): void {
    selectedIds = [];
    project = { ...project, pages: project.pages.map(page => ({ ...page, shapes: prepareShapes(page.shapes) })) };
    if (persist) {
      history.commit(project);
    } else {
      // The restored workspace is the starting point for this session's undo history.
      history.reset(project);
    }
    change(persist, true);
  }

  return {
    project: history.current,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    page,
    selected,
    selection,
    shapeById,
    select,
    selectOnly,
    selectMany,
    open,
    add,
    rename,
    removePage,
    put,
    patch,
    setText,
    apply,
    movable,
    copySelection,
    paste,
    nudge,
    align,
    group,
    ungroup,
    duplicate,
    remove,
    reorder,
    moveLayer,
    travel,
    replace,
  };
}
