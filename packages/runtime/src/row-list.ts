/**
 * Rows of a `map` call that a text site shows directly, in the old compiler's
 * list shape: compiled rows reconciled from the array, with no render value,
 * capture array or nested value slot per row (`compiler-next/src/optimize/row-lists.ts`).
 *
 * The compiler proved the callback is an arrow `(item, index) => <element …>`
 * whose `key`, if any, is its first dynamic attribute. Calling the compiled row
 * instead of the callback evaluates the same expressions in the same order: per
 * item, the key, then the other attributes and children as written.
 *
 * Row identity and matching are the general path's (`render-value.ts`,
 * `list-index.ts`): `key=` and the key as a string, or `#` and the index without
 * a key; each identity reuses its first previous row; old duplicates are never
 * reused; unmatched rows are removed in their old order, then old duplicates.
 * What differs is only the cost: a row still at its position needs no lookup or
 * string, the identity index is kept across passes instead of rebuilt, moves
 * follow the longest increasing subsequence, and a list that is the whole of
 * its parent clears in one call.
 */
import { createComputation, publishVersions, runningReadsChanged, trackRead } from './computation';
import { buildInScope, reserveCreationScope } from './adoption';
import { readListLength } from './list-values';
import { iteratedItems } from './list-map';
import { lisPositions } from './list';
import type { RenderOwner } from './render-value';

export interface RowEntry {
  /** The row's only root, an element. */
  readonly node: ChildNode;
  /** Evaluate the row's sites again, now for `item` at `index`. */
  update(item: unknown, index: number): void;
  /** Left out when the row holds nothing to release, which saves a closure per row. */
  dispose?(): void;
}

/** The row's `key` attribute, evaluated first; null when the row has no key. */
export type RowKey = (item: unknown, index: number) => unknown;
/** Create a row and evaluate its sites, except the key. */
export type RowFactory = (item: unknown, index: number) => RowEntry;

interface Row {
  readonly entry: RowEntry;
  /** Last item supplied to the entry; targeted refreshes must keep its index. */
  item: unknown;
  identity: Identity;
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

/**
 * Which items a closed list's edits left alone since its last pass: `true` for all of them, or
 * whether one item was left alone (`uneditedItems`). A row keeping such an item has nothing new.
 */
export type Unedited = boolean | ((item: unknown) => boolean);

/**
 * For rows that also read state outside their list: `unedited` when nothing the site read has
 * changed since its last pass, so only item edits brought it here; otherwise every row is
 * evaluated (false). The site's computation is running and keeps its reads across passes
 * (`begin(false)`), so `changed` still compares them with what the last pass saw.
 */
export function whenQuiet(unedited: Unedited): Unedited {
  return runningReadsChanged() ? false : unedited;
}

/**
 * The items edited since `before` edits, for a closed list (`compiler-next/src/optimize/closed-lists.ts`).
 * `editedAt` maps an item to the count of the edit that last changed it; an edit whose item is not
 * known sets the map itself, and then every item counts as edited.
 */
export function uneditedItems(editedAt: WeakMap<object, number>, before: number, now: number): Unedited {
  if (before !== now && (editedAt.get(editedAt) ?? 0) > before) return false;
  // Asked as each row is reached, not once before the pass, also when nothing was edited before
  // it: a row made earlier in this pass can edit a later row's item (a custom element's
  // constructor), and the reference, rendering rows in order, shows that edit in the later row.
  return (item) => item === null || typeof item !== 'object'
    || ((editedAt.get(item) ?? 0) <= before && (editedAt.get(editedAt) ?? 0) <= before);
}

export interface RowList {
  /**
   * `receiver.map(row)`: reconcile the rows. A receiver that is not an array has
   * its own `map`, which decides the items.
   *
   * `unedited`: the compiler proved rows show only their item and index, and that
   * no item was edited since the last call (`true`), or which items were not (a
   * predicate, `uneditedItems`; `compiler-next/src/optimize/closed-lists.ts`). A row
   * keeping such an item, and its index if it reads one, then has nothing to evaluate.
   */
  map(receiver: readonly unknown[] | { map(callback: (item: unknown) => void): unknown }, unedited?: Unedited): void;
  /**
   * `Array.from(items, row)`: reconcile the rows with the items `Array.from`
   * iterates (`iteratedItems`), where a hole is an `undefined` item.
   */
  from(items: unknown, unedited?: Unedited): void;
  /** Register a binding compared strictly with the row key, before the first map. */
  route(peek: () => unknown, version: () => number, key?: object): void;
  /** Unsupported keys need the authored map again. */
  changed(): boolean;
  /** Refresh only rows matching a routed binding's previous or current value. */
  refresh(computation?: ReturnType<typeof createComputation>): void;
  /**
   * A row observed an edit of what it shows, such as its props object, in a
   * handler. Rows have no own updates; the site that maps them runs again.
   */
  invalidate(): void;
  dispose(): void;
}

interface Route {
  readonly peek: () => unknown;
  readonly version: () => number;
  readonly key: object | undefined;
  readonly computation: ReturnType<typeof createComputation> | null;
  value: unknown;
  seen: number;
  ready: boolean;
}

/**
 * A row's identity: the key as a string, by value (`1` and `'1'` are one identity),
 * or its position without a key. Building a string per row costs real time on a large
 * list, so a number stands for itself and a string spelling that number becomes it.
 */
type Identity = number | string;

function identityOf(key: unknown, index: number): Identity {
  if (key === undefined || key === null) return `#${index}`;
  if (typeof key === 'number' && Number.isFinite(key)) return key;

  const text = String(key);
  const first = text.charCodeAt(0);

  // Only a digit or `-` can start a canonical finite number.
  if ((first >= 48 && first <= 57) || first === 45) {
    const value = +text;
    if (Number.isFinite(value) && String(value) === text) return value;
  }
  // `#<index>` is a position. Doubling a key's leading `#` keeps every key apart
  // from every position, and from every other key.
  return first === 35 ? `#${text}` : text;
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

export function createRowList(
  anchor: Text, owner: RenderOwner, key: RowKey | null, create: RowFactory,
  /**
   * The compiler-proven member chain from the item to its key, for routing. Null
   * when the items are records of plain fields (`optimize/closed-lists.ts`), whose
   * key needs no check that a field read gives the same value again.
   */
  keyPath?: readonly string[] | null,
): RowList {
  let rows: Row[] = [];
  /** Rows created by a pass that threw before committing them. */
  let pending: Row[] | null = null;
  let disposed = false;
  let routes: Route[] | null = null;
  let canRoute = false;
  /** The last pass finished, so every row shows its item. */
  let settled = false;
  /** A row edited what it shows (`invalidate`). */
  let invalidated = false;
  /** The committed array had holes, so a row's index may differ from its position. */
  let holes = false;
  /** Compiled rows take `(item, index)` only if they read the index. */
  const indexed = create.length > 1;
  /** Each row is numbered under this list, by its index when it is built (`adoption.ts`). */
  const scope = reserveCreationScope();

  function stableKey(item: unknown, key: unknown): boolean {
    if (keyPath === null) return true;
    if (keyPath === undefined) return false;
    let value = item;
    for (const member of keyPath) {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, member);
      if (descriptor === undefined || !('value' in descriptor)) return false;
      value = descriptor.value;
    }
    return Object.is(value, key);
  }

  function routeChanged(route: Route): boolean {
    return !route.ready || route.version() !== route.seen;
  }

  /** Shared bindings wake the owner once per list, never once per row. */
  function syncRoutes(): void {
    for (const route of routes ?? []) {
      const computation = route.computation;
      computation?.begin();
      if (route.key !== undefined) trackRead(route.version, null, route.key);
      route.value = route.peek();
      computation?.end();
      route.seen = route.version();
      route.ready = true;
    }
  }

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
        row.entry.dispose?.();
        detach(row);
      }
      return;
    }
    for (const row of removed) row.entry.dispose?.();
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
  let identities: Map<Identity, Row> | null = null;
  let pass = 0;
  /**
   * The largest number any row has had as its identity. A key above it is new, so
   * it needs no lookup, and a list keyed by growing ids never builds the index just
   * to create rows. Rows only leave, so it stays an upper bound.
   */
  let greatest = -Infinity;

  function lookup(): Map<Identity, Row> {
    if (identities === null) {
      identities = new Map();
      // The running pass may have created rows before anything needed the index.
      // Committed rows go last: a row replacing one of them only takes over on commit.
      for (const row of pending ?? []) if (!row.duplicate) identities.set(row.identity, row);
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
      row.entry.dispose?.();
      row.entry.node.parentNode?.removeChild(row.entry.node);
    }
  }

  /** `dense`: a hole is an `undefined` item (`from`), not skipped (`map`). */
  function reconcile(array: readonly unknown[], unedited: Unedited, dense: boolean): void {
    recover();
    // Rows are current only after a pass that finished, with no routed value or
    // invalidation since: those need the rows evaluated even with the same items.
    const current = settled && !invalidated && !(routes?.some(routeChanged) ?? false);
    // A row keeping an item no edit touched has nothing new to show. After an edit of some items
    // (`rows[i].label = x`), only their rows are evaluated.
    const trusted = current && unedited !== false;
    const kept = (item: unknown): boolean => trusted && (unedited === true || (unedited as (item: unknown) => boolean)(item));
    settled = false;
    invalidated = false;
    const previous = rows;
    const length = readListLength(array);
    const next: Row[] = [];
    // Applied on commit: a pass that throws leaves the committed rows as they were.
    // A row's index is its position in `next` unless the array has holes.
    let indexes: number[] | null = null;
    const created: Row[] = [];
    /** Matched rows whose key value changed, with the rows that replace them. */
    const replaced: [old: Row, row: Row][] = [];
    pending = created;
    const stamp = ++pass;
    let ordered = true;
    let routeable = routes !== null && key !== null;
    let last = -1;
    // A getter read by a key or row can render this site again, or dispose it.
    // The nested pass recovers this one's new rows and reconciles from the
    // committed rows; this pass then stops without committing anything.
    const superseded = (): boolean => pending !== created || disposed;
    for (let index = 0; index < length; index++) {
      if (!dense && !(index in array)) continue;
      if (indexes === null && index !== next.length) indexes = next.map((_, position) => position);
      const item = array[index];
      let row: Row | undefined = previous[last + 1];
      // The same item in the next row or the one before: unedited, so its key is
      // the same too, and neither the key nor the row needs evaluating.
      if (trusted && key !== null && kept(item)) {
        if (row === undefined || row.item !== item || row.taken === stamp || row.duplicate) row = previous[last - 1];
        if (row !== undefined && row.item === item && row.taken !== stamp && !row.duplicate && (!indexed || row.index === index)) {
          row.taken = stamp;
          if (row.position < last) ordered = false;
          last = row.position;
          if (routeable && !canRoute) routeable = false;
          next.push(row);
          indexes?.push(index);
          continue;
        }
        row = previous[last + 1];
      }
      const rowKey = key === null ? undefined : key(item, index);
      if (superseded()) return;
      // First-unused matching: a committed row that is not a duplicate is the
      // only first occurrence of its identity, so any such untaken row whose
      // identity agrees is the match. Try the rows after and before the last
      // match (unchanged, shifted, inserted or reversed runs); else look it up.
      if (!available(row, rowKey, index, stamp)) row = previous[last - 1];
      let identity: Identity | null = null;
      let duplicate = false;
      if (!available(row, rowKey, index, stamp)) {
        if (typeof rowKey === 'number' && rowKey > greatest && rowKey !== Infinity) {
          identity = rowKey;
          row = undefined;
        } else {
          identity = identityOf(rowKey, index);
          row = lookup().get(identity);
          // Taken already by an earlier item (or created by it): a duplicate.
          if (row !== undefined && row.taken === stamp) {
            duplicate = true;
            row = undefined;
          }
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
        const entry = buildInScope(scope, `r${index}`, () => create(item, index));
        if (superseded()) {
          entry.dispose?.();
          return;
        }
        row = { entry, item, identity: identity!, key: rowKey, index, position: -1, duplicate, taken: stamp };
        created.push(row);
        if (typeof identity === 'number' && identity > greatest) greatest = identity;
        if (old !== undefined) replaced.push([old, row]);
        else if (!duplicate) identities?.set(row.identity, row);
      } else {
        if (row.position < last) ordered = false;
        last = row.position;
        // Found by key, further away: the same reasoning holds.
        if (!kept(item) || row.item !== item || (indexed && row.index !== index)) {
          row.item = item;
          row.entry.update(item, index);
          if (superseded()) return;
        }
      }
      // These identities may alias or invoke authored conversion. Re-evaluate
      // the authored map on a routed change instead of using a cached lookup.
      if (routeable) {
        if (rowKey === null || rowKey === undefined || typeof rowKey === 'object'
          || typeof rowKey === 'function' || row.duplicate || !stableKey(item, rowKey)) routeable = false;
        if (superseded()) return;
      }
      next.push(row);
      indexes?.push(index);
    }

    // Commit. Authored code runs again only in the removed rows' disposal.
    pending = null;
    // The general order: unmatched first occurrences, then old duplicates.
    const removed: Row[] = [];
    for (const row of previous) if (row.taken !== stamp && !row.duplicate) removed.push(row);
    for (const row of previous) if (row.taken !== stamp && row.duplicate) removed.push(row);
    // With no old row staying, they leave first, as the general path removes them
    // before it mounts anything. The parent then holds only them, and clears in one call.
    const nothingStays = removed.length > 0 && removed.length === previous.length && replaced.length === 0;
    // Forgetting every row one by one costs more than building the index again.
    if (nothingStays || next.length === 0) identities = null;
    else for (const row of removed) forget(row);
    // No row is left to collide with, so the same ids can come back without a lookup.
    if (next.length === 0) greatest = -Infinity;
    for (const [, row] of replaced) identities?.set(row.identity, row);
    if (!nothingStays && (!ordered || created.length > 0)) place(next);
    // A matched row kept its key: another key value would have replaced it above. The
    // same rows in the same order at the same indexes have nothing to record.
    if (!ordered || created.length > 0 || next.length !== previous.length || indexes !== null || holes) {
      for (let position = 0; position < next.length; position++) {
        const row = next[position]!;
        row.index = indexes === null ? position : indexes[position]!;
        row.position = position;
      }
    }
    holes = indexes !== null;
    rows = next;
    canRoute = routeable;
    settled = true;
    if (nothingStays) {
      // A cleanup that throws must not leave the committed rows out of the page.
      try {
        removeRows(removed, 0);
      } finally {
        if (!disposed && next.length > 0) insertRows(next, 0, next.length - 1, anchor);
      }
      return;
    }
    if (removed.length > 0) removeRows(removed, next.length);
    // A value slot writes its rows after the unmatched ones are removed.
    for (const [old] of replaced) {
      old.entry.dispose?.();
      detach(old);
    }
  }

  /** Insert new rows and move retained ones, keeping the longest ordered run in place. */
  function place(next: readonly Row[]): void {
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
    const stays = (position: number) => sequence[position]! >= 0 && (kept === null || kept[position] === true);
    let before: Node = anchor;
    let position = next.length - 1;
    while (position >= 0) {
      if (stays(position)) {
        before = next[position]!.entry.node;
        position--;
        continue;
      }
      let start = position;
      while (start > 0 && !stays(start - 1)) start--;
      insertRows(next, start, position, before);
      before = next[start]!.entry.node;
      position = start - 1;
    }
  }

  /** A run of new or moved rows goes in as one fragment, as the old list did. */
  function insertRows(next: readonly Row[], start: number, end: number, before: Node): void {
    const parent = anchor.parentNode!;
    if (start === end) {
      parent.insertBefore(next[start]!.entry.node, before);
      return;
    }
    const fragment = anchor.ownerDocument.createDocumentFragment();
    for (let index = start; index <= end; index++) fragment.appendChild(next[index]!.entry.node);
    parent.insertBefore(fragment, before);
  }

  /** Leave rows mode the way a slot clears its rows: every row, in order. */
  function clearRows(): void {
    recover();
    const committed = rows;
    rows = [];
    identities = null;
    canRoute = false;
    if (committed.length > 0) removeRows(committed, 0);
  }

  // The mapping site reads this version, so `invalidate` re-runs that site.
  const versionKey = {};
  let version = 0;
  const current = () => version;
  return {
    map(receiver, unedited = false) {
      if (disposed) return;
      trackRead(current, null, versionKey);

      let items: readonly unknown[];
      if (Array.isArray(receiver)) {
        items = receiver;
      } else {
        const collected: unknown[] = [];
        (receiver as { map(callback: (item: unknown) => void): unknown }).map((item) => { collected.push(item); });
        items = collected;
      }

      reconcile(items, unedited, false);
      if (!disposed) syncRoutes();
    },
    from(items, unedited = false) {
      if (disposed) return;
      trackRead(current, null, versionKey);
      reconcile(iteratedItems(items), unedited, true);
      if (!disposed) syncRoutes();
    },
    route(peek, version, key) {
      if (disposed) return;
      (routes ??= []).push({
        peek, version, key, value: undefined, seen: -1, ready: false,
        computation: key === undefined ? null : createComputation(owner.batch?.mark, owner.entity),
      });
    },
    changed() {
      if (disposed) return false;
      if (pending !== null) return true;
      return !canRoute && (routes?.some(routeChanged) ?? false);
    },
    refresh(computation) {
      if (disposed || !canRoute || pending !== null || routes === null) return;
      const changed = routes.filter(routeChanged);
      if (changed.length === 0) return;
      const affected = new Set<Row>();
      const add = (value: unknown) => {
        // Primitive row keys cannot strictly equal an object, null or undefined.
        // In particular, never coerce an authored object to perform this lookup.
        if (value === null || value === undefined || typeof value === 'object' || typeof value === 'function') return;
        const row = lookup().get(identityOf(value, 0));
        if (row !== undefined && row.key === value) affected.add(row);
      };
      for (const route of changed) {
        const next = route.peek();
        if (route.ready && route.value === next) continue;
        add(route.value);
        add(next);
      }
      const stamp = pass;
      if (affected.size > 0) computation?.begin(false);
      // A full map evaluates rows in DOM order, regardless of which key changed.
      for (const row of [...affected].sort((left, right) => left.position - right.position)) {
        row.entry.update(row.item, row.index);
        if (disposed || pass !== stamp) {
          computation?.end(!disposed);
          return;
        }
      }
      if (affected.size > 0) computation?.end();
      syncRoutes();
    },
    invalidate() {
      if (disposed) return;
      invalidated = true;
      version++;
      publishVersions([versionKey]);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const subscriptions = routes;
      routes = null;
      // A row's disposal can throw. Release subscriptions before authored work.
      for (const route of subscriptions ?? []) route.computation?.dispose();
      clearRows();
    },
  };
}
