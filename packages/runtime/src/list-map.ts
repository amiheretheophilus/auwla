/**
 * `items.map(callback)` that reuses each item's previous result while nothing
 * it depends on changed. Used only for callbacks the compiler proved
 * (`compiler-next/src/optimize/row-reuse.ts`). Such a callback:
 *
 * - makes no explicit call, store, deletion or suspension (`effects.ts`);
 * - returns JSX, a compiler-owned value no authored code mutates;
 * - is an arrow with at most two parameters, and reads nothing reactive except
 *   through tracked readers, besides its first argument and, when `usesIndex`,
 *   its second.
 *
 * So an item's result can change only if the item is another value, was edited
 * since (`mutatedSince`), sits at another index the callback reads, or a tracked
 * read changed (its row computation). Otherwise the previous result is the value
 * the callback would rebuild, and it is returned without calling the callback.
 * Each row's tracked reads are shared with the computation around the call, so
 * the site that called `map` still re-runs when any of them changes.
 *
 * The result array has native `map`'s shape: the same length, holes where the
 * source has them, and the callback runs with `(value, index, array)`.
 */
import { createComputation } from './computation';
import { mutatedSince, mutationTime } from './mutation';
import { readListLength } from './list-values';

interface Row {
  readonly item: unknown;
  readonly index: number;
  readonly result: unknown;
  readonly time: number;
  readonly computation: ReturnType<typeof createComputation>;
}

/** Results the cache returned unchanged, with the mutation time it verified them at. */
const verified = new WeakMap<object, number>();

/**
 * Whether a row cache just returned `value` unchanged, with every input
 * verified, and nothing at all was edited since. A value slot writing the same
 * value again may then skip re-checking it; once only.
 */
export function takeVerified(value: object): boolean {
  const time = verified.get(value);
  verified.delete(value);
  return time === mutationTime();
}

export interface RowCache {
  /**
   * `dense`: a hole is an `undefined` item, as `Array.from` gives one, instead of
   * a hole in the result, as native `map` leaves one.
   */
  map(array: readonly unknown[], callback: Function, dense?: boolean): unknown[];
}

/** `receiver.map(callback)`, through the cache when the receiver is an array. */
export function mapRows(receiver: any, cache: RowCache, callback: Function): unknown {
  return Array.isArray(receiver) ? cache.map(receiver, callback) : receiver.map(callback);
}

const arrayValues = Array.prototype[Symbol.iterator];

/**
 * The items `Array.from(items)` would iterate. An array that iterates with the
 * intrinsic iterator gives its own elements in order, holes as `undefined`, so
 * it is read directly (`dense`). Anything else is collected the way `Array.from`
 * collects it: through its iterator, or as an array-like.
 */
export function iteratedItems(items: unknown): readonly unknown[] {
  if (Array.isArray(items) && items[Symbol.iterator] === arrayValues) return items;
  return Array.from(items as Iterable<unknown> | ArrayLike<unknown>);
}

/**
 * `Array.from(items, callback)`, through the cache. The compiler emits it only
 * for the intrinsic `Array.from` (`compiler-next/src/optimize/mapping-calls.ts`),
 * and only with a callback of at most `(item, index)`, so passing the array as
 * the third argument shows nothing.
 */
export function fromRows(items: unknown, cache: RowCache, callback: Function): unknown[] {
  return cache.map(iteratedItems(items), callback, true);
}

/**
 * General first-unused matching after the ordered prefix changes. A duplicate
 * consumes the next occurrence, even when its callback has to run again.
 */
class Rows {
  private readonly first = new Map<unknown, Row>();
  private more: Map<unknown, Row[]> | null = null;

  take(item: unknown): Row | undefined {
    const row = this.first.get(item);
    if (row !== undefined) {
      this.first.delete(item);
      return row;
    }
    return this.more?.get(item)?.shift();
  }

  put(row: Row): void {
    if (!this.first.has(row.item)) {
      this.first.set(row.item, row);
      return;
    }
    const more = this.more ??= new Map();
    const queue = more.get(row.item);
    if (queue === undefined) {
      more.set(row.item, [row]);
    } else {
      queue.push(row);
    }
  }
}

/**
 * An unchanged prefix already supplies the first unused occurrence. Match it
 * directly and create a lookup only for the suffix after the first mismatch.
 * Initial creation, in-place updates, append and truncation need no lookup.
 */
class RowMatcher {
  private offset = 0;
  private remaining: Rows | null = null;

  constructor(private readonly previous: readonly Row[] | null) {}

  take(item: unknown): Row | undefined {
    if (this.remaining !== null) {
      return this.remaining.take(item);
    }
    const row = this.previous?.[this.offset];
    if (row === undefined) {
      return undefined;
    }
    // Match Map's SameValueZero grouping here. The reuse check below still
    // distinguishes signed zeros before it can return a previous result.
    if (row.item === item || Object.is(row.item, item)) {
      this.offset++;
      return row;
    }

    const remaining = new Rows();
    for (let index = this.offset; index < this.previous!.length; index++) {
      remaining.put(this.previous![index]!);
    }
    this.remaining = remaining;
    return remaining.take(item);
  }
}

/** One per call site and owner instance. `usesIndex`: the callback reads its second argument. */
export function createRowCache(usesIndex: boolean): RowCache {
  let rows: readonly Row[] | null = null;
  return {
    map(array, callback, dense = false) {
      const cached = rows;
      // Reading an array element can run a getter, reenter or throw. Detach
      // before that work: reentry gets its own lookup, and a failed pass never
      // exposes the partially consumed matching state to a later mapping.
      rows = null;
      const length = readListLength(array);
      const result = new Array<unknown>(length);
      if (length === 0) {
        // Release the complete lookup at once, including after reentry from
        // the length read. Empty lists need no replacement matching table.
        rows = null;
        return result;
      }
      const previous = new RowMatcher(cached);
      const next: Row[] = [];
      for (let index = 0; index < length; index++) {
        if (!dense && !(index in array)) continue;
        const item = array[index];
        let row = previous.take(item);
        if (row !== undefined) {
          // Map groups +0 and -0 together, but authored arithmetic can tell
          // them apart. The lookup finds a candidate; Object.is proves reuse.
          const sameItem = Object.is(row.item, item);
          const moved = usesIndex && row.index !== index;
          if (!sameItem || moved || mutatedSince(item, row.time) || row.computation.changed()) {
            row = undefined;
          }
        }
        if (row === undefined) {
          const computation = createComputation();
          const time = mutationTime();
          computation.begin();
          const value = callback(item, index, array);
          computation.end();
          row = { item, index, result: value, time, computation };
        } else if (typeof row.result === 'object' && row.result !== null) {
          verified.set(row.result, mutationTime());
        }
        row.computation.share();
        result[index] = row.result;
        next.push(row);
      }
      rows = next;
      return result;
    },
  };
}
