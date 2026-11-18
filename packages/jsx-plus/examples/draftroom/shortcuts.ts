import type { Tool } from './model/types';

export const TOOLS: { id: Tool; label: string; shortcut: string; icon: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: 'cursor' },
  { id: 'hand', label: 'Hand', shortcut: 'H', icon: 'hand' },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: 'rectangle' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: 'ellipse' },
  { id: 'diamond', label: 'Diamond', shortcut: 'D', icon: 'diamond' },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', icon: 'arrow' },
  { id: 'pen', label: 'Pencil', shortcut: 'P', icon: 'pen' },
  { id: 'text', label: 'Text', shortcut: 'T', icon: 'text' },
  { id: 'note', label: 'Sticky note', shortcut: 'N', icon: 'note' },
  { id: 'frame', label: 'Frame', shortcut: 'F', icon: 'frame' },
];

interface Commands {
  choose(tool: Tool): void;
  select(id?: string): void;
  undo(): void;
  redo(): void;
  duplicate(): void;
  group(): void;
  ungroup(): void;
  remove(): void;
  editText(): boolean;
  nudge(x: number, y: number): void;
  zoom(factor: number): void;
  fit(): void;
}

export function bindShortcuts(commands: Commands): () => void {
  function handle(event: KeyboardEvent): void {
    const editingText = event.target instanceof HTMLElement
      && event.target.closest('input, textarea, select, [contenteditable]');
    if (event.defaultPrevented || editingText) {
      return;
    }

    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          commands.redo();
        } else {
          commands.undo();
        }
      } else if (key === 'g') {
        event.preventDefault();
        if (event.shiftKey) commands.ungroup();
        else commands.group();
      } else if (key === 'y' || key === 'd') {
        event.preventDefault();
        if (key === 'y') {
          commands.redo();
        } else {
          commands.duplicate();
        }
      }
      return;
    }

    if (event.altKey) {
      return;
    }

    const tool = TOOLS.find(item => item.shortcut.toLowerCase() === key);
    if (tool !== undefined) {
      commands.choose(tool.id);
      return;
    }

    const step = event.shiftKey ? 10 : 1;
    switch (key) {
      case 'enter':
        if (event.target instanceof HTMLCanvasElement && commands.editText()) {
          event.preventDefault();
        }
        break;
      case 'escape':
        commands.choose('select');
        commands.select();
        break;
      case 'backspace':
      case 'delete':
        event.preventDefault();
        commands.remove();
        break;
      case 'arrowleft':
        event.preventDefault();
        commands.nudge(-step, 0);
        break;
      case 'arrowright':
        event.preventDefault();
        commands.nudge(step, 0);
        break;
      case 'arrowup':
        event.preventDefault();
        commands.nudge(0, -step);
        break;
      case 'arrowdown':
        event.preventDefault();
        commands.nudge(0, step);
        break;
      case '=':
      case '+':
        commands.zoom(1.25);
        break;
      case '-':
        commands.zoom(0.8);
        break;
      case '0':
        commands.fit();
        break;
    }
  }

  window.addEventListener('keydown', handle);
  return () => window.removeEventListener('keydown', handle);
}
