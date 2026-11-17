import type { Project } from './types';

/** Snapshots share unchanged pages and shapes. Only completed edits enter this history. */
export function createHistory(initial: Project) {
  let current = initial;
  const past: Project[] = [];
  const future: Project[] = [];

  function commit(next: Project): void {
    if (next === current) {
      return;
    }

    past.push(current);
    if (past.length > 80) {
      past.shift();
    }
    current = next;
    future.length = 0;
  }

  function undo(): void {
    const previous = past.pop();
    if (previous === undefined) {
      return;
    }

    future.push(current);
    current = previous;
  }

  function redo(): void {
    const next = future.pop();
    if (next === undefined) {
      return;
    }

    past.push(current);
    current = next;
  }

  function reset(next: Project): void {
    current = next;
    past.length = 0;
    future.length = 0;
  }

  // Navigating between pages is remembered without spending an undo step.
  function navigate(activeId: string): void {
    current = { ...current, activeId };
  }

  return {
    current: () => current,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    navigate,
    commit,
    undo,
    redo,
    reset,
  };
}
