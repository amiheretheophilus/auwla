/**
 * Rows of a `map` call that a text site shows directly, in the old compiler's
 * list shape: compiled rows reconciled from the array, with no render value,
 * capture array or nested value slot per row (`compiler-next/src/optimize/row-lists.ts`).
 *
 * Used through `observeMethod` once the runtime has proven the callee is the
 * intrinsic `Array.prototype.map` on an ordinary array. The compiler proved the
 * callback is an arrow `(item, index) => <element …>` whose `key`, if any, is
 * its first dynamic attribute. Calling the compiled row instead of the callback
 * evaluates the same expressions in the same order: per item, the key, then the
 * other attributes and children as written. The value `map` would return only
 * reaches this site, so `map` returns a token the site's `write` ignores.
 *
 * Row identity and matching are the general path's (`render-value.ts`,
 * `list-index.ts`): `key=` and the key as a string, or `#` and the index without
 * a key; each identity reuses its first previous row; old duplicates are never
 * reused; unmatched rows are removed in their old order, then old duplicates.
 * What differs is only the cost: a row still at its position needs no lookup or
 * string, the identity index is kept across passes instead of rebuilt, moves
 * follow the longest increasing subsequence, and a list that is the whole of
 * its parent clears in one call.
 *
 * Any other value written to the site (the callee was not proven, so the
 * authored callback ran) goes to an ordinary value slot at the same anchor.
 */
import { readListLength } from './list-values';
import { lisPositions } from './list';
import { createIndexedValueSlot, type RenderOwner, type ValueSlot } from './render-value';

export interface RowEntry {
  /** The row's only root, an element. */
  readonly node: ChildNode;
  /** Evaluate the row's sites again, now for `item` at `index`. */
  update(item: unknown, index: number): void;
  dispose(): void;
}

/** The row's `key` attribute, evaluated first; null when the row has no key. */
export type RowKey = (item: unknown, index: number) => unknown;
/** Create a row and evaluate its sites, except the key. */
export type RowFactory = (item: unknown, index: number) => RowEntry;

interface Row {
  readonly entry: RowEntry;
  /** As the general path names it: `key=…`, or `#index` without a key. */
  identity: string;
  /** The key last evaluated; a primitive key that stays the same keeps its identity. */
  key: unknown;
  index: number;
  /** Position in the committed list; -1 for a row created by the running pass. */
  position: number;
  /** An earlier committed row has the same identity, so this one is never reused. */
  duplicate: boolean;
  /** The pass that matched or created it; a row is matched at most once per pass. */
  taken: number;
}

export interface RowList {
  /** The intrinsic `map` (`method-calls.ts`): reconcile the rows, return the token. */
  map(array: readonly unknown[], callback: Function, thisArg: unknown): unknown;
  /** The site's value: the token is already shown; anything else goes to a value slot. */
  write(value: unknown): void;
  dispose(): void;
}

function identityOf(key: unknown, index: number): string {
  return key === undefined || key === null ? `#${index}` : `key=${String(key)}`;
}

/** Whether `row` has the identity of `key` at `index`, without a string when that is decidable. */
function sameIdentity(row: Row, key: unknown, index: number): boolean {
  if (key === undefined || key === null) return (row.key === undefined || row.key === null) && row.index === index;
  // Converting an object key may run its `toString`, so it runs every time.
  if (key === row.key && typeof key !== 'object' && typeof key !== 'function') return true;
  return identityOf(key, index) === row.identity;
}

/** An untaken first occurrence with the identity of `key` at `index`. */
function available(row: Row | undefined, key: unknown, index: number, stamp: number): row is Row {
  return row !== undefined && row.taken !== stamp && !row.duplicate && sameIdentity(row, key, index);
}

export function createRowList(anchor: Text, owner: RenderOwner, key: RowKey | null, create: RowFactory): RowList {
  const token = Object.freeze({});
  let rows: Row[] = [];
  /** Rows created by a pass that threw before committing them. */
  let pending: Row[] | null = null;
  let slot: ValueSlot | null = null;
  let showingSlot = false;
  let disposed = false;

  /** A row's node leaves only the list's own parent, as a slot removes only its own range. */
  function detach(row: Row): void {
    const node = row.entry.node;
    if (node.parentNode === anchor.parentNode) node.parentNode?.removeChild(node);
  }

  /**
   * Dispose and detach `removed` in the given order. With no row left, a parent
   * that holds only these rows and the anchor clears in one call.
   */
  function removeRows(removed: readonly Row[], remaining: number): void {
    const parent = anchor.parentNode;
    const whole = (): boolean => remaining === 0 && parent !== null && parent.lastChild === anchor
      && parent.childNodes.length === removed.length + 1;
    if (!whole() || !removed.every((row) => row.entry.node.parentNode === parent)) {
      for (const row of removed) {
        row.entry.dispose();
        detach(row);
      }
      return;
    }
    for (const row of removed) row.entry.dispose();
    // A disposal can move nodes; then the rows leave one by one.
    if (whole()) {
      (parent as ParentNode).replaceChildren(anchor);
    } else {
      for (const row of removed) detach(row);
    }
  }

  /**
   * The first occurrence of each identity among the committed rows, kept
   * across passes and updated only for rows created, removed or mounted again.
   * A pass also enters its new first occurrences, so a later item with the same
   * identity becomes a duplicate. Built on first use.
   */
  let identities: Map<string, Row> | null = null;
  let pass = 0;

  function lookup(): Map<string, Row> {
    if (identities === null) {
      identities = new Map();
      for (const row of rows) if (!row.duplicate) identities.set(row.identity, row);
    }
    return identities;
  }

  function forget(row: Row): void {
    if (identities?.get(row.identity) === row) identities.delete(row.identity);
  }

  function recover(): void {
    // A key or row expression threw during the last pass. Its new rows were
    // never placed or committed; the committed rows still show valid items.
    if (pending === null) return;
    const created = pending;
    pending = null;
    for (const row of created) {
      forget(row);
      row.entry.dispose();
      row.entry.node.parentNode?.removeChild(row.entry.node);
    }
  }

  function reconcile(array: readonly unknown[]): void {
    recover();
    const previous = rows;
    const length = readListLength(array);
    const next: Row[] = [];
    // Applied on commit: a pass that throws leaves the committed identities.
    const keys: unknown[] = [];
    const indexes: number[] = [];
    const created: Row[] = [];
    /** Matched rows whose key value changed, with the rows that replace them. */
    const replaced: [old: Row, row: Row][] = [];
    pending = created;
    const stamp = ++pass;
    let ordered = true;
    let last = -1;
    // A getter read by a key or row can render this site again, or dispose it.
    // The nested pass recovers this one's new rows and reconciles from the
    // committed rows; this pass then stops without committing anything.
    const superseded = (): boolean => pending !== created || disposed;
    for (let index = 0; index < length; index++) {
      if (!(index in array)) continue;
      const item = array[index];
      const rowKey = key === null ? undefined : key(item, index);
      if (superseded()) return;
      // First-unused matching: a committed row that is not a duplicate is the
      // only first occurrence of its identity, so any such untaken row whose
      // identity agrees is the match. Try the rows after and before the last
      // match (unchanged, shifted, inserted or reversed runs); else look it up.
      let row: Row | undefined = previous[last + 1];
      if (!available(row, rowKey, index, stamp)) row = previous[last - 1];
      let identity: string | null = null;
      let duplicate = false;
      if (!available(row, rowKey, index, stamp)) {
        identity = identityOf(rowKey, index);
        row = lookup().get(identity);
        // Taken already by an earlier item (or created by it): a duplicate.
        if (row !== undefined && row.taken === stamp) {
          duplicate = true;
          row = undefined;
        }
      }
      let old: Row | undefined;
      if (row !== undefined) {
        row.taken = stamp;
        if (!Object.is(row.key, rowKey)) {
          // Same identity, another key value (`1` after `'1'`, `-0` after `0`):
          // a value slot mounts its row again (`render-value.ts`, `writeProgram`).
          old = row;
          identity ??= row.identity;
          row = undefined;
        }
      }
      if (row === undefined) {
        const entry = create(item, index);
        if (superseded()) {
          entry.dispose();
          return;
        }
        row = { entry, identity: identity!, key: rowKey, index, position: -1, duplicate, taken: stamp };
        created.push(row);
        if (old !== undefined) replaced.push([old, row]);
        else if (!duplicate) lookup().set(row.identity, row);
      } else {
        if (row.position < last) ordered = false;
        last = row.position;
        row.entry.update(item, index);
        if (superseded()) return;
      }
      next.push(row);
      keys.push(rowKey);
      indexes.push(index);
    }

    // Commit. Authored code runs again only in the removed rows' disposal.
    pending = null;
    // The general order: unmatched first occurrences, then old duplicates.
    const removed: Row[] = [];
    for (const row of previous) if (row.taken !== stamp && !row.duplicate) removed.push(row);
    for (const row of previous) if (row.taken !== stamp && row.duplicate) removed.push(row);
    for (const row of removed) forget(row);
    for (const [, row] of replaced) identities?.set(row.identity, row);
    if (!ordered || created.length > 0) place(next);
    for (let position = 0; position < next.length; position++) {
      const row = next[position]!;
      row.key = keys[position];
      row.index = indexes[position]!;
      row.position = position;
    }
    rows = next;
    if (removed.length > 0) removeRows(removed, next.length);
    // A value slot writes its rows after the unmatched ones are removed.
    for (const [old] of replaced) {
      old.entry.dispose();
      detach(old);
    }
  }

  /** Insert new rows and move retained ones, keeping the longest ordered run in place. */
  function place(next: readonly Row[]): void {
    const parent = anchor.parentNode!;
    const sequence: number[] = [];
    let ordered = true;
    let last = -1;
    for (const row of next) {
      sequence.push(row.position);
      if (row.position >= 0) {
        if (row.position < last) ordered = false;
        last = row.position;
      }
    }
    // `lisPositions` returns a shared buffer; it is read before any other call.
    const kept = ordered ? null : lisPositions(sequence, 0, sequence.length);
    let before: Node = anchor;
    for (let position = next.length - 1; position >= 0; position--) {
      const node = next[position]!.entry.node;
      const stays = sequence[position]! >= 0 && (kept === null || kept[position] === true);
      if (!stays) parent.insertBefore(node, before);
      before = node;
    }
  }

  /** Leave rows mode the way a slot clears its rows: every row, in order. */
  function clearRows(): void {
    recover();
    const committed = rows;
    rows = [];
    identities = null;
    if (committed.length > 0) removeRows(committed, 0);
  }

  return {
    map(array) {
      if (disposed) return token;
      if (showingSlot) {
        // Writing text clears whatever the slot showed; the anchor stays.
        slot!.write('');
        showingSlot = false;
      }
      reconcile(array);
      return token;
    },
    write(value) {
      if (disposed || value === token) return;
      clearRows();
      (slot ??= createIndexedValueSlot(anchor, owner)).write(value);
      showingSlot = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearRows();
      slot?.dispose();
    },
  };
}
