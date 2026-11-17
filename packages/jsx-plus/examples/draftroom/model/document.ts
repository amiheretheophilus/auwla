import { createHistory } from './history';
import { brainstorm, workflow } from './templates';
import { canEditText, makePage, type Page, type Project, type Shape } from './types';

export function createDocument(initial: Project, change: (persist: boolean, refit: boolean) => void) {
  const history = createHistory(initial);
  let selectedId: string | undefined;

  function page(): Page {
    const project = history.current();
    return project.pages.find(item => item.id === project.activeId) ?? project.pages[0]!;
  }

  function selected(): Shape | undefined {
    return shapeById(selectedId);
  }

  function shapeById(id: string | undefined): Shape | undefined {
    return page().shapes.find(shape => shape.id === id);
  }

  function select(id?: string): void {
    if (selectedId === id) {
      return;
    }
    selectedId = id;
    change(false, false);
  }

  function setPage(next: Page): void {
    const project = history.current();
    const pages = project.pages.map(item => item.id === next.id ? next : item);
    history.commit({ ...project, pages });
    change(true, false);
  }

  function open(id: string): void {
    const project = history.current();
    if (project.activeId === id || !project.pages.some(item => item.id === id)) {
      return;
    }
    selectedId = undefined;
    history.navigate(id);
    change(true, true);
  }

  function add(template?: 'workflow' | 'brainstorm'): void {
    const project = history.current();
    let next: Page;
    if (template === 'workflow') {
      next = makePage('Product flow', workflow());
    } else if (template === 'brainstorm') {
      next = makePage('Brainstorm', brainstorm());
    } else {
      next = makePage(`Untitled board ${project.pages.length + 1}`);
    }

    selectedId = undefined;
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
    selectedId = undefined;
    history.commit({ ...project, activeId: pages[0]!.id, pages });
    change(true, true);
  }

  function put(shape: Shape): void {
    const current = page();
    const shapes = current.shapes.some(item => item.id === shape.id)
      ? current.shapes.map(item => item.id === shape.id ? shape : item)
      : [...current.shapes, shape];

    selectedId = shape.id;
    setPage({ ...current, shapes });
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
    const shape = selected();
    if (shape === undefined || shape.locked) {
      return;
    }

    put({
      ...shape,
      id: crypto.randomUUID(),
      title: `${shape.title} copy`,
      x: shape.x + 24,
      y: shape.y + 24,
    });
  }

  function remove(): void {
    const shape = selected();
    if (shape === undefined || shape.locked) {
      return;
    }

    const current = page();
    selectedId = undefined;
    setPage({ ...current, shapes: current.shapes.filter(item => item.id !== shape.id) });
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
      change(true, before.activeId !== after.activeId);
    }
  }

  function replace(project: Project, persist: boolean): void {
    selectedId = undefined;
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
    shapeById,
    select,
    open,
    add,
    rename,
    removePage,
    put,
    patch,
    setText,
    duplicate,
    remove,
    reorder,
    moveLayer,
    travel,
    replace,
  };
}
