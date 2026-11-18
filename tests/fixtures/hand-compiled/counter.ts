/**
 * A hand-written component for the kernel's tests (`m0.test.ts`): an entity whose render writes
 * its text only when the value changed. It used the old compiler's setter helpers, which went
 * with that compiler (2026-11-18); the guard is written out here instead.
 */
import { register, markDirty, type EntityId } from '@memoized-dom/runtime';

export function Counter(id: EntityId, parent: EntityId | null = null): HTMLButtonElement {
  // ---- state: component-local, private to this instance -------------------
  let count = 0;

  // ---- creation branch (runs once) ----------------------------------------
  const button = document.createElement('button');
  button.append('count: ');
  const t = document.createTextNode('');
  let shown: number | undefined;
  const show = () => {
    // Guarded: no DOM write when count is unchanged.
    if (shown === count) return;
    shown = count;
    t.data = String(count);
  };
  show();
  button.appendChild(t);

  button.onclick = () => {
    count++;
    markDirty(id);
  };

  // ---- entity registration: the update branch ------------------------------
  register({ id, parent, render: show });

  return button;
}
