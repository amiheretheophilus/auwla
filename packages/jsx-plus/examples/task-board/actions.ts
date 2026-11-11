/**
 * An ordinary exported handler, imported by App.auwla and used as
 * `onClick=focusTaskInput`. The native click event is passed straight through.
 */
export function focusTaskInput(event: MouseEvent): void {
  const button = event.currentTarget;
  if (!(button instanceof HTMLElement)) {
    return;
  }
  button.closest('main')?.querySelector<HTMLInputElement>('#new-task')?.focus();
}
