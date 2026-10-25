/** Native first-unused behavior and retained-index work, without timing claims. */
import { afterEach, expect, it } from 'bun:test';
import { createRetainedListIndex } from '../src/list-index';
import { reconcileList, type RowOperations } from '../src/list-values';

interface Row {
  readonly identity: string;
  readonly instance: number;
}

function operations() {
  let next = 0;
  const removed: Row[] = [];
  const actions: RowOperations<Row> = {
    identity: (value) => String(value),
    create: (identity) => ({ identity, instance: next++ }),
    remove: (row) => removed.push(row),
  };
  return { actions, removed };
}

it('matches the general path through duplicate keys, reorder, insertion and removal', () => {
  const indexed = createRetainedListIndex<Row>();
  const fast = operations();
  const general = operations();
  let fastRows: Row[] = [];
  let generalRows: Row[] = [];
  const inputs = [
    ['a', 'b', 'b', 'c'],
    ['b', 'a', 'b', 'd'],
    ['b', 'b', 'a', 'd'],
    ['d', 'a'],
    [],
    ['a', 'a', 'b'],
  ];
  for (const values of inputs) {
    fastRows = indexed.reconcile(fastRows, values, fast.actions).rows;
    generalRows = reconcileList(generalRows, values, general.actions).rows;
    expect(fastRows).toEqual(generalRows);
    expect(fast.removed).toEqual(general.removed);
  }
});

it('matches every three-step sequence of binary-key lists up to length three', () => {
  const inputs: string[][] = [[]];
  for (let length = 1; length <= 3; length++) {
    for (let pattern = 0; pattern < 2 ** length; pattern++) {
      inputs.push(Array.from({ length }, (_, index) => (pattern & (1 << index)) === 0 ? 'a' : 'b'));
    }
  }
  for (const first of inputs) {
    for (const second of inputs) {
      for (const third of inputs) {
        const indexed = createRetainedListIndex<Row>();
        const fast = operations();
        const general = operations();
        let fastRows: Row[] = [];
        let generalRows: Row[] = [];
        const sequence = [first, second, third];
        for (const values of sequence) {
          fastRows = indexed.reconcile(fastRows, values, fast.actions).rows;
          generalRows = reconcileList(generalRows, values, general.actions).rows;
          expect({ sequence, rows: fastRows, removed: fast.removed }).toEqual({
            sequence,
            rows: generalRows,
            removed: general.removed,
          });
        }
      }
    }
  }
});

it('recovers from a throwing key conversion without keeping a partial index', () => {
  const indexed = createRetainedListIndex<Row>();
  const { actions, removed } = operations();
  const previous = indexed.reconcile([], ['a', 'b'], actions).rows;
  const throwing = {
    toString() {
      throw new Error('native key failure');
    },
  };
  expect(() => indexed.reconcile(previous, ['new', throwing], actions)).toThrow('native key failure');
  const next = indexed.reconcile(previous, ['b', 'a', 'new'], actions).rows;
  expect(next[0]).toBe(previous[1]);
  expect(next[1]).toBe(previous[0]);
  // The abandoned 'new' row is not reused by a later reconciliation.
  expect(next[2]?.instance).toBe(3);
  expect(removed).toEqual([]);
});

it('keeps nested reconciliations independent when a key conversion reenters', () => {
  const indexed = createRetainedListIndex<Row>();
  const { actions } = operations();
  const previous = indexed.reconcile([], ['a', 'b'], actions).rows;
  let nested: Row[] = [];
  const reentrant = {
    toString() {
      nested = indexed.reconcile(previous, ['b', 'a'], actions).rows;
      return 'b';
    },
  };
  const next = indexed.reconcile(previous, ['a', reentrant], actions).rows;
  expect(next).toEqual(previous);
  expect(nested).toEqual([previous[1]!, previous[0]!]);
  expect(indexed.reconcile(nested, ['a', 'b'], actions).rows).toEqual(previous);
});

it('preserves inherited children, getter order and native proxy length conversion', () => {
  const indexed = createRetainedListIndex<Row>();
  const { actions } = operations();
  const reads: string[] = [];
  const source = new Array(4);
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, 1, {
    get() {
      reads.push('inherited');
      return 'a';
    },
  });
  Object.setPrototypeOf(source, prototype);
  Object.defineProperty(source, 3, {
    get() {
      reads.push('own');
      return 'b';
    },
  });
  const values = new Proxy(source, {
    get(target, key, receiver) {
      if (key === 'length') {
        return 3.9;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const next = indexed.reconcile([], values, actions);
  expect(next.values).toEqual(['a']);
  expect(reads).toEqual(['inherited']);
});

const NativeMap = globalThis.Map;
afterEach(() => {
  globalThis.Map = NativeMap;
});

it('builds one matching map for repeated 1000-row work instead of one per update', () => {
  let builds = 0;
  globalThis.Map = class CountedMap<Key, Value> extends NativeMap<Key, Value> {
    constructor(entries?: Iterable<readonly [Key, Value]> | null) {
      super(entries);
      builds++;
    }
  };
  const values = Array.from({ length: 1000 }, (_, index) => String(index));
  const fast = operations();
  const general = operations();
  const indexed = createRetainedListIndex<Row>();
  let fastRows: Row[] = [];
  for (let update = 0; update < 30; update++) {
    fastRows = indexed.reconcile(fastRows, values, fast.actions).rows;
    values.reverse();
  }
  const retainedBuilds = builds;
  builds = 0;
  let generalRows: Row[] = [];
  for (let update = 0; update < 30; update++) {
    generalRows = reconcileList(generalRows, values, general.actions).rows;
    values.reverse();
  }
  const generalBuilds = builds;
  indexed.clear();
  indexed.reconcile(fastRows, values, fast.actions);
  const afterClear = builds - generalBuilds;
  globalThis.Map = NativeMap;
  expect(retainedBuilds).toBe(1);
  expect(generalBuilds).toBe(30);
  expect(afterClear).toBe(1);
});
