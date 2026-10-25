/**
 * `items.map(callback)` that reuses each item's previous result while nothing
 * it depends on changed. Used only through `observeMethod` once the runtime has
 * proven the callee is the intrinsic `Array.prototype.map` on an ordinary array,
 * and only for callbacks the compiler proved (`compiler-next/src/optimize/methods.ts`,
 * "row reuse"). Such a callback:
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
 * source has none, and the callback runs with `thisArg` and `(value, index, array)`.
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
  map(array: readonly unknown[], callback: Function, thisArg: unknown): unknown[];
}

/**
 * Rows by item, in array order. An item can appear more than once: its first
 * row is in `first`, later ones queue in `more`, so each occurrence takes the
 * row of the same occurrence last time.
 */
class Rows {
  readonly first = new Map<unknown, Row>();
  more: Map<unknown, Row[]> | null = null;

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
    if (queue === undefined) more.set(row.item, [row]);
    else queue.push(row);
  }
}

/** One per call site and owner instance. `usesIndex`: the callback reads its second argument. */
export function createRowCache(usesIndex: boolean): RowCache {
  let rows = new Rows();
  return {
    map(array, callback, thisArg) {
      const previous = rows;
      const next = new Rows();
      const length = readListLength(array);
      const result = new Array<unknown>(length);
      for (let index = 0; index < length; index++) {
        if (!(index in array)) continue;
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
          const value = Reflect.apply(callback, thisArg, [item, index, array]);
          computation.end();
          row = { item, index, result: value, time, computation };
        } else if (typeof row.result === 'object' && row.result !== null) {
          verified.set(row.result, mutationTime());
        }
        row.computation.share();
        result[index] = row.result;
        next.put(row);
      }
      rows = next;
      return result;
    },
  };
}
