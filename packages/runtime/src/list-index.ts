/** Retain the first row for each identity without rebuilding a matching map. */
import { readListValues, type ListValues, type RowOperations, type ValueRow } from './list-values';

interface IndexedRow<Row> {
  readonly row: Row;
  used: object | null;
}

interface CachedIndex<Row> {
  readonly rows: readonly Row[];
  readonly lookup: Map<string, IndexedRow<Row>>;
}

export interface RetainedListIndex<Row extends ValueRow> {
  reconcile(
    previous: readonly Row[],
    items: readonly unknown[],
    operations: RowOperations<Row>,
  ): ListValues<Row>;
  clear(): void;
}

function indexRows<Row extends ValueRow>(rows: readonly Row[]): Map<string, IndexedRow<Row>> {
  const lookup = new Map<string, IndexedRow<Row>>();
  for (const row of rows) {
    // The general path retains the first old occurrence. Later duplicates are
    // never reused, even when the next input contains the same duplicate keys.
    if (!lookup.has(row.identity)) {
      lookup.set(row.identity, { row, used: null });
    }
  }
  return lookup;
}

export function createRetainedListIndex<Row extends ValueRow>(): RetainedListIndex<Row> {
  let cached: CachedIndex<Row> | null = null;

  return {
    reconcile(
      previous: readonly Row[],
      items: readonly unknown[],
      operations: RowOperations<Row>,
    ): ListValues<Row> {
      const lookup = cached?.rows === previous ? cached.lookup : indexRows(previous);
      // Detach before a getter, key conversion or disposal can run authored
      // code. A throw leaves no cached partial index. A reentrant call gets
      // its own records; row-array identity validates whichever call finishes.
      cached = null;
      const used = {};
      const next = readListValues(items, (value, index) => {
        const identity = operations.identity(value, index);
        const candidate = lookup.get(identity);
        if (candidate !== undefined && candidate.used !== used) {
          candidate.used = used;
          return candidate.row;
        }

        const row = operations.create(identity);
        if (candidate === undefined) {
          lookup.set(identity, { row, used });
        }
        return row;
      });

      let duplicates: Row[] | null = null;
      for (const row of previous) {
        const candidate = lookup.get(row.identity);
        if (candidate === undefined || candidate.row !== row) {
          (duplicates ??= []).push(row);
          continue;
        }
        if (candidate.used === used) {
          continue;
        }
        lookup.delete(row.identity);
        operations.remove(row);
      }
      // Teardown is observable: the general path removes unmatched primary
      // rows first, then old duplicates in their original order.
      if (duplicates !== null) {
        for (const row of duplicates) {
          operations.remove(row);
        }
      }
      cached = { rows: next.rows, lookup };
      return next;
    },
    clear(): void {
      cached = null;
    },
  };
}
