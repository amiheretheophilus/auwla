import { expect, it } from 'bun:test';
import { createRowCache, takeVerified } from '../src/list-map';
import { createComputation, publishVersions, trackRead } from '../src/computation';
import { mutationTarget } from '../src/mutation';

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
