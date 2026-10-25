import { afterEach, expect, it } from 'bun:test';
import { createRowCache, takeVerified } from '../src/list-map';
import { createComputation, publishVersions, trackRead } from '../src/computation';
import { mutationTarget } from '../src/mutation';

const NativeMap = globalThis.Map;
afterEach(() => {
  globalThis.Map = NativeMap;
});

/** A callback that counts its calls and returns a fresh object per call, like JSX. */
function counted() {
  const calls: unknown[] = [];
  const callback = (item: { id: number }, index?: number) => {
    calls.push(item);
    return { id: item.id, index };
  };
  return { calls, callback };
}

const items = (count: number) => Array.from({ length: count }, (_, id) => ({ id }));

it('matches unchanged ordered rows without building replacement lookups', () => {
  const cache = createRowCache(false);
  const rows = items(200);
  const { callback } = counted();
  let maps = 0;
  globalThis.Map = class extends NativeMap {
    constructor(...args: ConstructorParameters<MapConstructor>) {
      super(...args);
      maps++;
    }
  } as MapConstructor;
  cache.map(rows, callback, undefined);
  for (let update = 0; update < 30; update++) {
    cache.map(rows, callback, undefined);
  }
  cache.map([...rows, rows[0]], callback, undefined);
  cache.map(rows.slice(0, 20), callback, undefined);
  expect(maps).toBe(0);
  cache.map([], callback, undefined);
  for (let update = 0; update < 30; update++) {
    cache.map([], callback, undefined);
  }
  expect(maps).toBe(0);
});

it('reuses each unchanged item result and calls the callback only for new items', () => {
  const cache = createRowCache(false);
  const { calls, callback } = counted();
  const rows = items(4);
  const first = cache.map(rows, callback, undefined);
  expect(calls).toHaveLength(4);
  calls.length = 0;
  const added = { id: 9 };
  const second = cache.map([rows[2]!, added, rows[0]!], callback, undefined);
  expect(calls).toEqual([added]);
  expect(second[0]).toBe(first[2]);
  expect(second[2]).toBe(first[0]);
});

it('distinguishes signed zero when deciding whether an item is unchanged', () => {
  const cache = createRowCache(false);
  const callback = (item: number) => ({ inverse: 1 / item });
  const first = cache.map([0, -0], callback, undefined);
  const second = cache.map([-0, 0], callback, undefined);
  expect(second.map((row) => (row as { inverse: number }).inverse)).toEqual([-Infinity, Infinity]);
  expect(second[0] === first[0]).toBe(false);
  expect(second[1] === first[1]).toBe(false);
});

it('uses native length conversion for array proxies before creating a result', () => {
  const cache = createRowCache(false);
  let length: unknown = '3.9';
  const array = new Proxy([], {
    get(target, key, receiver) {
      return key === 'length' ? length : Reflect.get(target, key, receiver);
    },
  });
  const callback = () => ({});
  expect(cache.map(array, callback, undefined)).toHaveLength(3);
  length = -1;
  expect(cache.map(array, callback, undefined)).toHaveLength(0);
  length = 1n;
  expect(() => cache.map(array, callback, undefined)).toThrow(TypeError);
});

it('calls again for an item edited in place, and for a moved item when the index is read', () => {
  const rows = items(3);
  const byItem = createRowCache(false);
  const byIndex = createRowCache(true);
  const one = counted();
  const two = counted();
  byItem.map(rows, one.callback, undefined);
  byIndex.map(rows, two.callback, undefined);
  one.calls.length = 0;
  two.calls.length = 0;
  mutationTarget(rows[1]!, 'id', () => {}).value = 7;
  const reordered = [rows[2]!, rows[1]!, rows[0]!];
  byItem.map(reordered, one.callback, undefined);
  byIndex.map(reordered, two.callback, undefined);
  expect(one.calls).toEqual([rows[1]]);
  // Index 1 keeps its item but the item was edited; the others moved.
  expect(two.calls).toEqual(reordered);
});

it('keeps native map shape: holes, duplicates, thisArg and arguments', () => {
  const cache = createRowCache(true);
  const item = { id: 1 };
  const seen: unknown[][] = [];
  const array = [item, , item] as { id: number }[];
  const result = cache.map(array, function (this: unknown, ...args: unknown[]) {
    seen.push([this, ...args]);
    return { args };
  }, 'self');
  expect(result).toHaveLength(3);
  expect(1 in result).toBe(false);
  expect(seen).toEqual([['self', item, 0, array], ['self', item, 2, array]]);
  expect(result[0]).not.toBe(result[2]);
  const again = cache.map(array, () => ({}), 'self');
  expect(again[0]).toBe(result[0]);
  expect(again[2]).toBe(result[2]);
});

it('keeps duplicate occurrence order through replacement, removal and reappearance', () => {
  const cache = createRowCache(false);
  const a = { id: 1 };
  const b = { id: 2 };
  const { calls, callback } = counted();
  const first = cache.map([a, a, a, b], callback, undefined);
  const moved = cache.map([a, b, a, a], callback, undefined);
  expect(moved[0]).toBe(first[0]);
  expect(moved[1]).toBe(first[3]);
  expect(moved[2]).toBe(first[1]);
  expect(moved[3]).toBe(first[2]);
  mutationTarget(a, 'id', () => {}).value = 10;
  const edited = cache.map([a, b, a, a], callback, undefined);
  expect(edited[0] === first[0]).toBe(false);
  expect(edited[2] === first[1]).toBe(false);
  expect(edited[1]).toBe(first[3]);
  cache.map([a], callback, undefined);
  calls.length = 0;
  const added = cache.map([a, a], callback, undefined);
  expect(added[0]).toBe(edited[0]);
  expect(added[1] === edited[2]).toBe(false);
  expect(calls).toEqual([a]);
});

it('matches first-unused reuse through every three-step binary-item sequence', () => {
  const a = { id: 1 };
  const b = { id: 2 };
  const inputs: object[][] = [[]];
  for (let length = 1; length <= 3; length++) {
    for (let pattern = 0; pattern < 2 ** length; pattern++) {
      inputs.push(Array.from({ length }, (_, index) => {
        return (pattern & (1 << index)) === 0 ? a : b;
      }));
    }
  }

  interface ModelRow {
    readonly item: object;
    readonly index: number;
    readonly value: number;
  }
  for (const usesIndex of [false, true]) {
    for (const first of inputs) {
      for (const second of inputs) {
        for (const third of inputs) {
          const cache = createRowCache(usesIndex);
          let previous: ModelRow[] = [];
          let expectedCalls = 0;
          let actualCalls = 0;
          for (const input of [first, second, third]) {
            // This deliberately uses a small linear search, independently of
            // the runtime's ordered prefix and its suffix lookup.
            const used = new Set<ModelRow>();
            const expected = input.map((item, index): ModelRow => {
              const row = previous.find((candidate) => {
                return candidate.item === item && !used.has(candidate);
              });
              if (row !== undefined) {
                used.add(row);
                if (!usesIndex || row.index === index) {
                  return row;
                }
              }
              return { item, index, value: expectedCalls++ };
            });
            const actual = cache.map(input, () => ({ value: actualCalls++ }), undefined);
            expect(actual.map((row) => (row as { value: number }).value))
              .toEqual(expected.map((row) => row.value));
            previous = expected;
          }
        }
      }
    }
  }
});

it('matches duplicate occurrences when holes move between them', () => {
  const cache = createRowCache(false);
  const a = { id: 1 };
  const b = { id: 2 };
  const { callback, calls } = counted();
  const first = cache.map([a, , b, a], callback, undefined);
  calls.length = 0;
  const second = cache.map([, a, a, b], callback, undefined);
  expect(0 in second).toBe(false);
  expect(second[1]).toBe(first[0]);
  expect(second[2]).toBe(first[3]);
  expect(second[3]).toBe(first[2]);
  expect(calls).toEqual([]);
});

it('keeps a reentrant mapping independent of the outer pending lookup', () => {
  const cache = createRowCache(false);
  const rows = items(3);
  const { callback } = counted();
  cache.map(rows, callback, undefined);
  let enter = true;
  const array = rows.slice(0, 2);
  Object.defineProperty(array, 0, {
    get() {
      if (enter) {
        enter = false;
        cache.map([rows[2]], callback, undefined);
      }
      return rows[0];
    },
    configurable: true,
  });
  const outer = cache.map(array, callback, undefined);
  const next = cache.map([rows[1], rows[0]], callback, undefined);
  expect(next[0]).toBe(outer[1]);
  expect(next[1]).toBe(outer[0]);
});

it('recovers after an element read interrupts matching partway through', () => {
  const cache = createRowCache(false);
  const rows = items(3);
  const { callback } = counted();
  cache.map(rows, callback, undefined);
  const array = rows.slice();
  Object.defineProperty(array, 1, {
    get() { throw new Error('element read'); },
    configurable: true,
  });
  expect(() => cache.map(array, callback, undefined)).toThrow('element read');
  const next = cache.map([rows[2], rows[0], rows[2]], callback, undefined);
  expect(next.map((row) => (row as { id: number }).id)).toEqual([2, 0, 2]);
  expect(next[0] === next[2]).toBe(false);
});

it('discards a reentrant lookup when the outer length read resolves to an empty list', () => {
  const cache = createRowCache(false);
  const rows = items(3);
  const { callback } = counted();
  cache.map(rows, callback, undefined);
  let inner: unknown[] = [];
  const array = new Proxy([], {
    get(target, key, receiver) {
      if (key === 'length') {
        inner = cache.map([rows[2]], callback, undefined);
        return 0;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  expect(cache.map(array, callback, undefined)).toEqual([]);
  const next = cache.map([rows[2]], callback, undefined);
  expect(next[0] === inner[0]).toBe(false);
});

it('recomputes a row whose tracked read changed and shares every row read with the caller', () => {
  const key = {};
  let version = 0;
  const cache = createRowCache(false);
  const rows = items(3);
  let calls = 0;
  const callback = (item: { id: number }) => {
    calls++;
    return { id: item.id, version: trackRead(() => version, version, key) };
  };
  const outer = createComputation(() => {});
  outer.begin();
  cache.map(rows, callback, undefined);
  outer.end();
  expect(outer.dependsOn(key)).toBe(true);
  calls = 0;
  version++;
  publishVersions([key]);
  expect(outer.changed()).toBe(true);
  outer.begin();
  const next = cache.map(rows, callback, undefined);
  outer.end();
  expect(calls).toBe(3);
  expect(outer.dependsOn(key)).toBe(true);
  expect(next.map((row) => (row as { version: number }).version)).toEqual([1, 1, 1]);
  // Reused rows still report their reads to the caller.
  calls = 0;
  outer.begin();
  cache.map(rows, callback, undefined);
  outer.end();
  expect(calls).toBe(0);
  expect(outer.dependsOn(key)).toBe(true);
});

it('marks a reused result verified only until anything is edited', () => {
  const cache = createRowCache(false);
  const rows = items(2);
  const first = cache.map(rows, (item: { id: number }) => ({ id: item.id }), undefined);
  expect(takeVerified(first[0] as object)).toBe(false);
  cache.map(rows, (item: { id: number }) => ({ id: item.id }), undefined);
  expect(takeVerified(first[0] as object)).toBe(true);
  expect(takeVerified(first[0] as object)).toBe(false);
  cache.map(rows, (item: { id: number }) => ({ id: item.id }), undefined);
  mutationTarget({}, 'x', () => {}).value = 1;
  expect(takeVerified(first[1] as object)).toBe(false);
});
