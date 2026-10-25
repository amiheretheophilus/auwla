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

/** The first occurrence also owns the private matching state for its item. */
interface RowHead extends Row {
  generation: object;
  used: number;
  previousCount: number;
  duplicates: Row[] | null;
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
 * Retain one lookup across successful mappings. Each generation consumes old
 * occurrences in order, then publishes their replacements at those positions.
 * The first row holds the bookkeeping so unique items need no wrapper object
 * or duplicate array. Nothing is attached to authored items or result values.
 */
class Rows {
  private readonly first = new Map<unknown, RowHead>();

  take(item: unknown, generation: object): Row | undefined {
    const head = this.first.get(item);
    if (head === undefined) {
      return undefined;
    }
    if (head.generation !== generation) {
      head.generation = generation;
      head.used = 0;
      head.previousCount = 1 + (head.duplicates?.length ?? 0);
    }
    const occurrence = head.used++;
    if (occurrence >= head.previousCount) {
      return undefined;
    }
    return occurrence === 0 ? head : head.duplicates?.[occurrence - 1];
  }

  put(row: Row, generation: object): void {
    const previous = this.first.get(row.item);
    if (previous === undefined || previous.used === 1) {
      if (previous === row) {
        return;
      }
      // Promote this private row in place, avoiding a separate record for the
      // common unique-item case. A replaced first row keeps its old dup queue.
      const head = row as RowHead;
      head.generation = generation;
      head.used = previous?.used ?? 1;
      head.previousCount = previous?.previousCount ?? 0;
      head.duplicates = previous?.duplicates ?? null;
      this.first.set(row.item, head);
      return;
    }
    const duplicates = previous.duplicates ??= [];
    duplicates[previous.used - 2] = row;
  }

  finish(generation: object): void {
    for (const [item, head] of this.first) {
      if (head.generation !== generation) {
        this.first.delete(item);
      } else if (head.duplicates !== null) {
        head.duplicates.length = head.used - 1;
        if (head.duplicates.length === 0) {
          head.duplicates = null;
        }
      }
    }
  }
}

/** One per call site and owner instance. `usesIndex`: the callback reads its second argument. */
export function createRowCache(usesIndex: boolean): RowCache {
  let rows: Rows | null = null;
  return {
    map(array, callback, thisArg) {
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
      const previous = cached ?? new Rows();
      const generation = {};
      for (let index = 0; index < length; index++) {
        if (!(index in array)) continue;
        const item = array[index];
        let row = previous.take(item, generation);
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
        previous.put(row, generation);
      }
      previous.finish(generation);
      rows = previous;
      return result;
    },
  };
}
