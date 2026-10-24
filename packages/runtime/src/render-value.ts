/** Stored JSX carries captured inputs for one compiled DOM binding program. */
import type { Entity } from './kernel';
import { setTextData } from './setters';
import type { createWriteBatch } from './write-batch';

export interface RenderOwner {
  readonly id: string;
  readonly entity: Entity | undefined;
  readonly batch: ReturnType<typeof createWriteBatch> | null;
  readonly namespace?: 'html' | 'svg';
}
export interface RenderEntry {
  readonly nodes: readonly Node[];
  update(values: readonly unknown[]): void;
  dispose(): void;
}
export interface RenderProgram {
  mount(values: readonly unknown[], owner: RenderOwner): RenderEntry;
}
interface CapturedRender {
  readonly program: RenderProgram;
  readonly values: readonly unknown[];
}

// Metadata stays outside the authored value. Looking it up must not invoke a
// getter or proxy trap on an ordinary object passed to a child slot.
const captures = new WeakMap<object, CapturedRender>();

/** Creating JSX evaluates its inputs now; DOM is owned independently by each slot. */
export function createRenderValue(program: RenderProgram, values: readonly unknown[]): object {
  const value = {};
  captures.set(value, { program, values });
  return value;
}

function childNamespace(parent: Node, owner: RenderOwner): 'html' | 'svg' {
  // A detached fragment has no element from which to infer its namespace.
  if (parent.nodeType !== 1) {
    return owner.namespace ?? 'html';
  }

  const element = parent as Element;
  const isSvg = element.namespaceURI === 'http://www.w3.org/2000/svg';
  return isSvg && element.localName !== 'foreignObject' ? 'svg' : 'html';
}

export function createValueSlot(text: Text, owner: RenderOwner) {
  let currentProgram: RenderProgram | null = null;
  let entry: RenderEntry | null = null;
  let openingAnchor: Comment | null = null;
  let disposed = false;

  function clear(): void {
    entry?.dispose();
    entry = null;
    currentProgram = null;

    if (openingAnchor === null) {
      return;
    }

    // Nested regions may replace their roots. Remove the live range between
    // anchors rather than relying on the nodes returned by the original mount.
    let node = openingAnchor.nextSibling;
    while (node !== null && node !== text) {
      const next = node.nextSibling;
      node.parentNode!.removeChild(node);
      node = next;
    }

    openingAnchor.remove();
    openingAnchor = null;
  }

  return {
    write(value: unknown) {
      if (disposed) {
        return;
      }

      const captured = value !== null && typeof value === 'object'
        ? captures.get(value)
        : undefined;

      // compiler-next renders an array child as a list from Phase 5. Until
      // then, fail loudly rather than join the items into text.
      if (Array.isArray(value)) {
        throw new Error('compiler-next renders an array child as a list from Phase 5 of wiki/compiler/plan.md');
      }

      if (captured === undefined) {
        clear();
        setTextData(text, value);
        return;
      }

      // Re-evaluating one JSX expression changes its captures, not its DOM
      // identity. Each consuming slot still owns a separate mounted entry.
      if (currentProgram === captured.program && entry !== null) {
        entry.update(captured.values);
        return;
      }

      clear();
      setTextData(text, '');

      const parent = text.parentNode!;
      openingAnchor = text.ownerDocument.createComment('mmd:value');
      parent.insertBefore(openingAnchor, text);

      const namespace = childNamespace(parent, owner);
      entry = captured.program.mount(captured.values, { ...owner, namespace });
      currentProgram = captured.program;

      for (const node of entry.nodes) {
        parent.insertBefore(node, text);
      }
    },
    dispose() {
      clear();
      disposed = true;
    },
  };
}
