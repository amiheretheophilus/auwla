/** Stored JSX carries captured inputs for one compiled DOM binding program. */
import type { Entity } from './kernel';
import { setTextData } from './setters';
import type { createWriteBatch } from './write-batch';
import { reconcileList, type RowOperations } from './list-values';
import { createRetainedListIndex, type RetainedListIndex } from './list-index';
import { takeVerified } from './list-map';

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
  /** The root element's `key`; undefined when it has none. */
  readonly key: unknown;
}

// Metadata stays outside the authored value. Looking it up must not invoke a
// getter or proxy trap on an ordinary object passed to a child slot.
const captures = new WeakMap<object, CapturedRender>();

/** Creating JSX evaluates its inputs now; DOM is owned independently by each slot. */
export function createRenderValue(program: RenderProgram, values: readonly unknown[], key?: unknown): object {
  const value = {};
  captures.set(value, { program, values, key });
  return value;
}

function capturedOf(value: unknown): CapturedRender | undefined {
  return value !== null && typeof value === 'object' ? captures.get(value) : undefined;
}

export function renderNamespace(parent: Node, namespace: 'html' | 'svg' = 'html'): 'html' | 'svg' {
  // A detached fragment has no element from which to infer its namespace.
  if (parent.nodeType !== 1) {
    return namespace;
  }

  const element = parent as Element;
  const isSvg = element.namespaceURI === 'http://www.w3.org/2000/svg';
  return isSvg && element.localName !== 'foreignObject' ? 'svg' : 'html';
}

export interface ValueSlot {
  write(value: unknown): void;
  first(): Node;
  moveBefore(reference: Node): void;
  dispose(): void;
  remove(): void;
}

/** One row of a list: its identity and the slot that renders it. */
interface Row {
  readonly identity: string;
  readonly slot: ValueSlot;
  readonly text: Text;
}

/**
 * A row keeps its DOM while its identity stays: the element's `key` when it has
 * one, its position otherwise, as the reference matches children
 * (`wiki/compiler/conditionals-and-lists.md`, "Lists").
 */
function rowIdentity(item: unknown, index: number): string {
  const captured = capturedOf(item);
  const key = captured?.key;
  if (key === undefined || key === null) return `#${index}`;
  // Converting an object key may run its `toString`, so it runs every time.
  if (typeof key === 'object' || typeof key === 'function') return `key=${String(key)}`;
  // A value's primitive key never changes: build its identity once, which a
  // reused row value (`list-map.ts`) then keeps across updates.
  let identity = keyIdentities.get(captured!);
  if (identity === undefined) keyIdentities.set(captured!, identity = `key=${String(key)}`);
  return identity;
}
const keyIdentities = new WeakMap<CapturedRender, string>();

/**
 * Shows any child value at `text`, its end anchor: text, one stored JSX value,
 * or an array as a list of rows. Content other than text sits between an
 * opening comment and `text`, so the whole range can be moved or removed.
 */
export function createValueSlot(text: Text, owner: RenderOwner): ValueSlot {
  return createSlot(text, owner, false);
}

/** Same child semantics, with a retained private index for array rows. */
export function createIndexedValueSlot(text: Text, owner: RenderOwner): ValueSlot {
  return createSlot(text, owner, true);
}

function createSlot(text: Text, owner: RenderOwner, indexed: boolean): ValueSlot {
  let currentProgram: RenderProgram | null = null;
  let currentKey: unknown;
  /** The stored JSX value last written through `writeProgram`. */
  let currentValue: unknown;
  let entry: RenderEntry | null = null;
  let rows: Row[] | null = null;
  let rowIndex: RetainedListIndex<Row> | null = null;
  let rowOperations: RowOperations<Row> | null = null;
  let openingAnchor: Comment | null = null;
  let disposed = false;

  function clear(): void {
    rowIndex?.clear();
    rowIndex = null;
    rowOperations = null;
    entry?.dispose();
    entry = null;
    currentProgram = null;
    currentKey = undefined;
    currentValue = undefined;
    if (rows !== null) {
      for (const row of rows) row.slot.dispose();
      rows = null;
    }

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

  function open(label: string): void {
    setTextData(text, '');
    openingAnchor = text.ownerDocument.createComment(label);
    text.parentNode!.insertBefore(openingAnchor, text);
  }

  function writeProgram(captured: CapturedRender): void {
    // Re-evaluating one JSX expression changes its captures, not its DOM
    // identity. Each consuming slot still owns a separate mounted entry. A
    // changed key is a new identity, so it mounts again.
    if (currentProgram === captured.program && Object.is(currentKey, captured.key) && entry !== null) {
      entry.update(captured.values);
      return;
    }

    clear();
    open('mmd:value');
    const parent = text.parentNode!;
    const namespace = renderNamespace(parent, owner.namespace);
    entry = captured.program.mount(captured.values, { ...owner, namespace });
    currentProgram = captured.program;
    currentKey = captured.key;

    for (const node of entry.nodes) {
      parent.insertBefore(node, text);
    }
  }

  function writeList(items: readonly unknown[]): void {
    if (rows === null) {
      clear();
      open('mmd:list');
      rows = [];
    }

    // These operations belong to the list instance, not each update. In
    // particular, a retained list does not allocate two new row closures per
    // reconciliation, and moving the range does not leave a captured parent.
    rowOperations ??= {
      identity: rowIdentity,
      create(identity) {
        const anchor = text.ownerDocument.createTextNode('');
        text.parentNode!.insertBefore(anchor, text);
        return { identity, slot: createSlot(anchor, owner, indexed), text: anchor };
      },
      remove(row) {
        row.slot.remove();
      },
    };
    if (indexed) {
      rowIndex ??= createRetainedListIndex<Row>();
    }
    const next = rowIndex === null
      ? reconcileList(rows, items, rowOperations)
      : rowIndex.reconcile(rows, items, rowOperations);

    // Place rows from the end, moving only a row not already before the next.
    let reference: Node = text;
    for (let index = next.rows.length - 1; index >= 0; index--) {
      const row = next.rows[index]!;
      if (row.text.nextSibling !== reference) row.slot.moveBefore(reference);
      reference = row.slot.first();
    }

    rows = next.rows;
    rows.forEach((row, index) => row.slot.write(next.values[index]));
  }

  const slot = {
    write(value: unknown) {
      if (disposed) {
        return;
      }
      if (Array.isArray(value)) {
        writeList(value);
        return;
      }
      const captured = capturedOf(value);
      if (captured === undefined) {
        clear();
        setTextData(text, value);
        currentValue = undefined;
        return;
      }
      // A row cache reused this exact value, verified unchanged, with no edit
      // since (`list-map.ts`): updating it again would find nothing to do.
      if (value === currentValue && entry !== null && takeVerified(value as object)) {
        return;
      }
      writeProgram(captured);
      currentValue = value;
    },
    /** The first node of this slot's range. */
    first(): Node {
      return openingAnchor ?? text;
    },
    /** Move the whole range, in order, before `reference`. */
    moveBefore(reference: Node): void {
      const parent = reference.parentNode!;
      let node: Node | null = slot.first();
      while (node !== null) {
        const next: Node | null = node === text ? null : node.nextSibling;
        parent.insertBefore(node, reference);
        node = next;
      }
    },
    dispose() {
      clear();
      disposed = true;
    },
    /** Dispose, and remove the end anchor too. */
    remove() {
      slot.dispose();
      text.remove();
    },
  };
  return slot;
}
