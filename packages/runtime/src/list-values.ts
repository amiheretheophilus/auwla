/** Array-child traversal and row matching, independent of authored method names. */
export interface ValueRow {
  readonly identity: string;
}

export interface RowOperations<Row extends ValueRow> {
  identity(value: unknown, index: number): string;
  create(identity: string): Row;
  remove(row: Row): void;
}

export interface ListValues<Row extends ValueRow> {
  readonly rows: Row[];
  readonly values: unknown[];
}

/**
 * Match native array child traversal: capture the length, skip absent indices,
 * include inherited indices, and read each present value once. Calling an
 * authored `items.map` here would execute unrelated application code.
 */
function readRows<Row extends ValueRow>(
  items: readonly unknown[],
  take: (value: unknown, index: number) => Row,
): ListValues<Row> {
  const rows: Row[] = [];
  const values: unknown[] = [];
  // A proxy may supply a non-integer length. Unary + retains native ToNumber
  // errors for Symbols/BigInts; truncation and clamping implement ToLength.
  const length = Math.min(Math.max(Math.trunc(+items.length), 0), Number.MAX_SAFE_INTEGER);
  for (let index = 0; index < length; index++) {
    if (!(index in items)) {
      continue;
    }
    const value = items[index];
    rows.push(take(value, index));
    values.push(value);
  }
  return { rows, values };
}

/** General first-unused matching, with a new lookup for every reconciliation. */
export function reconcileList<Row extends ValueRow>(
  previous: readonly Row[],
  items: readonly unknown[],
  operations: RowOperations<Row>,
): ListValues<Row> {
  const unused = new Map<string, Row>();
  const duplicates: Row[] = [];
  for (const row of previous) {
    if (unused.has(row.identity)) {
      duplicates.push(row);
    } else {
      unused.set(row.identity, row);
    }
  }

  const next = readRows(items, (value, index) => {
    const identity = operations.identity(value, index);
    const row = unused.get(identity);
    if (row !== undefined) {
      unused.delete(identity);
      return row;
    }
    return operations.create(identity);
  });

  for (const row of unused.values()) {
    operations.remove(row);
  }
  for (const row of duplicates) {
    operations.remove(row);
  }
  return next;
}
