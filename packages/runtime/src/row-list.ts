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
import { createComputation, publishVersions, trackRead } from './computation';
import { readListLength } from './list-values';
import { lisPositions } from './list';
import { createIndexedValueSlot, type RenderOwner, type ValueSlot } from './render-value';
import { editTime, mutationTime } from './mutation';

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
  /** Last item supplied to the entry; targeted refreshes must keep its index. */
  item: unknown;
  /** The identity (`Identity`): its canonical key, or its index without a key. */
  identity: unknown;
  /** Whether `identity` is an index (`#index` in the general path). */
  indexed: boolean;
  /** The key last evaluated; a primitive key that stays the same keeps its identity. */
  key: unknown;
  index: number;
  /** Position in the committed list; -1 for a row created by the running pass. */
  position: number;
  /** An earlier committed row has the same identity, so this one is never reused. */
  duplicate: boolean;
  /** The pass that matched or created it; a row is matched at most once per pass. */
  taken: number;
  /** Key and index from the running pass, applied when it commits. */
  nextKey: unknown;
  nextIndex: number;
  /** The item, key and edit time at which the routing proof last held. */
  provenItem: unknown;
  provenKey: unknown;
  provenAt: number;
}

export interface RowList {
  /** The intrinsic `map` (`method-calls.ts`): reconcile the rows, return the token. */
  map(array: readonly unknown[], callback: Function, thisArg: unknown): unknown;
  /** The site's value: the token is already shown; anything else goes to a value slot. */
  write(value: unknown): void;
  /** Register a binding compared strictly with the row key, before the first map. */
  route(peek: () => unknown, version: () => number, key?: object): void;
  /** Unsupported keys or the value-slot fallback need the authored map again. */
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
 * The general path names a keyed row `key=${String(key)}`: two keys are the
 * same identity exactly when their strings are equal. This is that identity
 * without building the string. A string that is the canonical form of a number
 * (`String(Number(s)) === s`) stands for that number, so `'1'` and `1` meet;
 * the inverse of a number's canonical string is the number itself, so a number
 * needs no conversion. Any other string stands for itself. Map's SameValueZero
 * then equates exactly the keys whose strings are equal (`-0` and `0` are both
 * `'0'`, `NaN` is `'NaN'`; `'-0'` and `'1e21'` are not canonical, so they stay
 * strings). Other keys convert with `String` first; an object's `toString` runs
 * once per item and pass, as in the general path.
 */
function canonical(key: unknown): unknown {
  if (typeof key === 'number') return key;
  const text = typeof key === 'string' ? key : String(key);
  const number = Number(text);
  return String(number) === text ? number : text;
}

/** SameValueZero, as Map compares identities. */
function sameValueZero(left: unknown, right: unknown): boolean {
  return left === right || (left !== left && right !== right);
}

/** An item's identity before it is needed. */
const UNSET: unique symbol = Symbol('unset');

/** An untaken first occurrence, or undefined. */
function untaken(row: Row | undefined, stamp: number): Row | undefined {
  return row !== undefined && row.taken !== stamp && !row.duplicate ? row : undefined;
}

/**
 * Whether `row` has the identity of an item with `key`, without converting the
 * key when that is decidable; undefined when the canonical identity is needed.
 * `identity` is the item's index when `indexed`, else its canonical key or UNSET.
 * Two numbers, or two strings, are the same identity exactly when they are
 * SameValueZero (distinct numbers have distinct canonical strings).
 */
function identityMatch(row: Row, key: unknown, indexed: boolean, identity: unknown): boolean | undefined {
  if (indexed || row.indexed) return indexed && row.indexed && row.identity === identity;
  if (identity !== UNSET) return sameValueZero(identity, row.identity);
  const kind = typeof key;
  if ((kind === 'number' || kind === 'string') && typeof row.key === kind) return sameValueZero(key, row.key);
  return undefined;
}

export function createRowList(
  anchor: Text, owner: RenderOwner, key: RowKey | null, create: RowFactory,
  /** The compiler-proven member chain from the item to its key, for routing. */
  keyPath?: readonly string[],
): RowList {
  const token = Object.freeze({});
  let rows: Row[] = [];
  /** Rows created by a pass that threw before committing them. */
  let pending: Row[] | null = null;
  let slot: ValueSlot | null = null;
  let showingSlot = false;
  let disposed = false;
  let routes: Route[] | null = null;
  let canRoute = false;

  function stableKey(item: unknown, key: unknown): boolean {
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

  /**
   * `stableKey`, reused while it is known to hold. Every compiled edit stamps
   * the object it changed (`mutation.ts`), including an observed call that
   * turns the key into an accessor, so a single-member path proven for this
   * item and key still holds while the item has no later stamp. Longer paths
   * pass through objects the row does not keep, and are proven every pass.
   */
  function proven(row: Row, item: unknown, key: unknown): boolean {
    if (keyPath !== undefined && keyPath.length === 1 && row.provenAt >= 0 && row.provenItem === item
      && Object.is(row.provenKey, key) && editTime(item as object) <= row.provenAt) return true;
    if (!stableKey(item, key)) return false;
    row.provenItem = item;
    row.provenKey = key;
    row.provenAt = mutationTime();
    return true;
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
   * identity becomes a duplicate. Built on first use. Keyed and index
   * identities (`key=…` and `#…`) never meet, so they have separate maps.
   */
  let identities: { readonly keyed: Map<unknown, Row>; readonly indexed: Map<unknown, Row> } | null = null;
  let pass = 0;
  /** The array of the rows two passes ago, reused for the next pass's rows. */
  let spare: Row[] | null = null;

  function lookup(indexed: boolean): Map<unknown, Row> {
    if (identities === null) {
      identities = { keyed: new Map(), indexed: new Map() };
      for (const row of rows) {
        if (!row.duplicate) (row.indexed ? identities.indexed : identities.keyed).set(row.identity, row);
      }
    }
    return indexed ? identities.indexed : identities.keyed;
  }

  function forget(row: Row): void {
    if (identities === null) return;
    const map = row.indexed ? identities.indexed : identities.keyed;
    if (map.get(row.identity) === row) map.delete(row.identity);
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
    // A nested pass finds no spare and allocates its own.
    const next = spare ?? [];
    spare = null;
    let count = 0;
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
      if (!(index in array)) continue;
      const item = array[index];
      const rowKey = key === null ? undefined : key(item, index);
      if (superseded()) return;
      // First-unused matching: a committed row that is not a duplicate is the
      // only first occurrence of its identity, so any such untaken row whose
      // identity agrees is the match. Try the rows after and before the last
      // match (unchanged, shifted, inserted or reversed runs); else look it up.
      const indexed = rowKey === undefined || rowKey === null;
      // Computed at most once per item: converting an object key runs its `toString`.
      let identity: unknown = indexed ? index : UNSET;
      let row = untaken(previous[last + 1], stamp);
      let match = row === undefined ? false : identityMatch(row, rowKey, indexed, identity);
      if (match === undefined) match = sameValueZero(identity = canonical(rowKey), row!.identity);
      if (!match) {
        row = untaken(previous[last - 1], stamp);
        match = row === undefined ? false : identityMatch(row, rowKey, indexed, identity);
        if (match === undefined) match = sameValueZero(identity = canonical(rowKey), row!.identity);
      }
      let duplicate = false;
      if (!match) {
        if (identity === UNSET) identity = canonical(rowKey);
        row = lookup(indexed).get(identity);
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
          identity = row.identity;
          row = undefined;
        }
      }
      if (row === undefined) {
        const entry = create(item, index);
        if (superseded()) {
          entry.dispose();
          return;
        }
        row = {
          entry, item, identity, indexed, key: rowKey, index, position: -1, duplicate, taken: stamp,
          nextKey: rowKey, nextIndex: index, provenItem: undefined, provenKey: undefined, provenAt: -1,
        };
        created.push(row);
        if (old !== undefined) replaced.push([old, row]);
        else if (!duplicate) lookup(indexed).set(identity, row);
      } else {
        if (row.position < last) ordered = false;
        last = row.position;
        row.item = item;
        row.entry.update(item, index);
        if (superseded()) return;
      }
      // These identities may alias or invoke authored conversion. Re-evaluate
      // the authored map on a routed change instead of using a cached lookup.
      if (routeable) {
        if (rowKey === null || rowKey === undefined || typeof rowKey === 'object'
          || typeof rowKey === 'function' || row.duplicate || !proven(row, item, rowKey)) routeable = false;
        if (superseded()) return;
      }
      // Applied on commit: a pass that throws leaves the committed keys and indexes.
      row.nextKey = rowKey;
      row.nextIndex = index;
      next[count++] = row;
    }
    next.length = count;

    // Commit. Authored code runs again only in the removed rows' disposal.
    pending = null;
    // The general order: unmatched first occurrences, then old duplicates.
    const removed: Row[] = [];
    for (const row of previous) if (row.taken !== stamp && !row.duplicate) removed.push(row);
    for (const row of previous) if (row.taken !== stamp && row.duplicate) removed.push(row);
    // With no row left, the identities go with them.
    if (count === 0) identities = null;
    else for (const row of removed) forget(row);
    for (const [, row] of replaced) {
      if (identities !== null) (row.indexed ? identities.indexed : identities.keyed).set(row.identity, row);
    }
    if (!ordered || created.length > 0) place(next);
    for (let position = 0; position < count; position++) {
      const row = next[position]!;
      row.key = row.nextKey;
      row.index = row.nextIndex;
      row.position = position;
    }
    rows = next;
    // Nothing refers to the previous rows' array any longer.
    spare = previous;
    canRoute = routeable;
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
    const stays = (position: number) => sequence[position]! >= 0 && (kept === null || kept[position] === true);
    let before: Node = anchor;
    let position = next.length - 1;
    while (position >= 0) {
      if (stays(position)) {
        before = next[position]!.entry.node;
        position--;
        continue;
      }
      // A run of new or moved rows goes in as one fragment, as the old list did.
      let start = position;
      while (start > 0 && !stays(start - 1)) start--;
      if (start === position) {
        parent.insertBefore(next[position]!.entry.node, before);
      } else {
        const fragment = anchor.ownerDocument.createDocumentFragment();
        for (let index = start; index <= position; index++) fragment.appendChild(next[index]!.entry.node);
        parent.insertBefore(fragment, before);
      }
      before = next[start]!.entry.node;
      position = start - 1;
    }
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
    map(array) {
      if (disposed) return token;
      trackRead(current, null, versionKey);
      if (showingSlot) {
        // Writing text clears whatever the slot showed; the anchor stays.
        slot!.write('');
        showingSlot = false;
      }
      reconcile(array);
      if (!disposed) syncRoutes();
      return token;
    },
    write(value) {
      if (disposed || value === token) return;
      clearRows();
      (slot ??= createIndexedValueSlot(anchor, owner)).write(value);
      showingSlot = true;
      syncRoutes();
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
      return (!canRoute || showingSlot) && (routes?.some(routeChanged) ?? false);
    },
    refresh(computation) {
      if (disposed || showingSlot || !canRoute || pending !== null || routes === null) return;
      const changed = routes.filter(routeChanged);
      if (changed.length === 0) return;
      const affected = new Set<Row>();
      const add = (value: unknown) => {
        // Primitive row keys cannot strictly equal an object, null or undefined.
        // In particular, never coerce an authored object to perform this lookup.
        if (value === null || value === undefined || typeof value === 'object' || typeof value === 'function') return;
        const row = lookup(false).get(canonical(value));
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
        if (disposed || showingSlot || pass !== stamp) {
          computation?.end(!disposed);
          return;
        }
      }
      if (affected.size > 0) computation?.end();
      syncRoutes();
    },
    invalidate() {
      if (disposed) return;
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
      slot?.dispose();
    },
  };
}
