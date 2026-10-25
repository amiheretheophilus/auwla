import { expect, it } from 'bun:test';
import {
  captureMutationScope, deleteMutation, mutatedSince, mutationTarget, mutationTime, observeMutation,
  registerSharedMutationRoots,
} from '../src/mutation';
import { sameProps } from '../src/components';
import { createSharedWrites } from '../src/shared-writes';
import { createComputation, trackRead } from '../src/computation';

/** A root that holds `value` and counts its notifications. */
function root(initial: unknown) {
  const watched = { value: initial, notified: 0 };
  const entry = { read: () => watched.value, notify: () => { watched.notified++; } };
  registerSharedMutationRoots({}, [entry]);
  return watched;
}

/** `object[key] = value` as compiled code writes it, for a root it is not read through. */
function store(object: object, key: PropertyKey, value: unknown): void {
  mutationTarget(object, key, () => {}).value = value;
}

it('notifies only the roots whose data includes the edited object', () => {
  const shared = { done: false };
  const list = root([shared, { done: false }]);
  const copy = root({ item: shared });
  const other = root({ item: { done: false } });
  store(shared, 'done', true);
  expect([list.notified, copy.notified, other.notified]).toEqual([1, 1, 0]);
  store(list.value as object, 'length', 1);
  expect([list.notified, copy.notified, other.notified]).toEqual([2, 1, 0]);
});

it('follows objects that compiled stores add, and forgets the ones they remove', () => {
  const added = { n: 0 };
  const removed = { n: 0 };
  const holder = root({ slot: removed });
  store(holder.value as object, 'slot', added);
  expect(holder.notified).toBe(1);
  store(added, 'n', 1);
  expect(holder.notified).toBe(2);
  store(removed, 'n', 1);
  expect(holder.notified).toBe(2);
  deleteMutation(holder.value, 'slot', () => {});
  expect(holder.notified).toBe(3);
  store(added, 'n', 2);
  expect(holder.notified).toBe(3);
});

it('walks a root again when its binding holds a new value or an opaque call reshaped it', () => {
  const first = { n: 0 };
  const second = { n: 0 };
  const holder = root([first]);
  store(first, 'n', 1);
  holder.value = [second];
  store(second, 'n', 1);
  expect(holder.notified).toBe(2);
  const pushed = { n: 0 };
  const list = holder.value as object[];
  observeMutation([() => list], [() => {}]).finish(list.push(pushed));
  expect(holder.notified).toBe(3);
  store(pushed, 'n', 1);
  expect(holder.notified).toBe(4);
});

it('observes cyclic data, symbols, hidden fields and native collections without invoking getters', () => {
  const key = Symbol();
  let getterCalls = 0, notifications = 0;
  const value: any = { map: new Map([[1, { n: 1 }]]), set: new Set([1]), get unused() { getterCalls++; return 0; } };
  value.self = value;
  Object.defineProperty(value, key, { value: 1, writable: true });
  const observe = () => observeMutation([() => value], [() => notifications++]);
  observe().finish(undefined);
  expect(notifications).toBe(0);
  const first = observe();
  value.map.get(1).n++;
  first.finish('native result');
  const second = observe();
  value[key]++;
  value.set.add(2);
  expect(second.finish(9)).toBe(9);
  expect(notifications).toBe(2);
  expect(getterCalls).toBe(0);
});

it('recovers partial mutations synchronously at a catch boundary and only reports once', async () => {
  const item = { count: 0 };
  let notifications = 0;
  const restore = captureMutationScope();
  const observation = observeMutation([() => item], [() => notifications++]);
  item.count++;
  restore();
  expect(notifications).toBe(1);
  observation.finish(undefined);
  await Promise.resolve();
  expect(notifications).toBe(1);
});

it('retains key coercion and reports only completed native stores', () => {
  const log: unknown[] = [];
  const item = { count: 1 };
  const key = { [Symbol.toPrimitive]() { log.push('key'); return 'count'; } };
  const target = mutationTarget(item, key, () => log.push('write'));
  log.push('rhs');
  target.value = 4;
  expect(log).toEqual(['key', 'rhs', 'write']);
  expect(item.count).toBe(4);
});

it('tells whether a value or the data below it was edited since a time', () => {
  const nested = { label: 'a' };
  const item = { id: 1, nested };
  const other = { id: 2 };
  const before = mutationTime();
  expect(mutatedSince(item, before)).toBe(false);
  mutationTarget(nested, 'label', () => {}).value = 'b';
  expect(mutatedSince(item, before)).toBe(true);
  expect(mutatedSince(other, before)).toBe(false);
  const after = mutationTime();
  expect(mutatedSince(item, after)).toBe(false);
  // Edits inside an opaque call are found by its snapshots.
  observeMutation([() => other], [() => {}]).finish(Object.assign(other, { id: 3 }));
  expect(mutatedSince(other, after)).toBe(true);
  expect(mutatedSince(item, after)).toBe(false);
});

it('stamps an edit before notifying, so a synchronous reader sees it', () => {
  const item = { label: 'a' };
  const before = mutationTime();
  let seen = false;
  mutationTarget(item, 'label', () => { seen = mutatedSince(item, before); }).value = 'b';
  expect(seen).toBe(true);
});

it('compares props objects by their fields', () => {
  const item = {};
  expect(sameProps({ item, n: 1 }, { item, n: 1 })).toBe(true);
  expect(sameProps({ item, n: 1 }, { item, n: 2 })).toBe(false);
  expect(sameProps({ item }, { item, n: undefined })).toBe(false);
  expect(sameProps({ a: 1 }, { b: 1 })).toBe(false);
  expect(sameProps([1, item], [1, item])).toBe(true);
  expect(sameProps([1], { 0: 1 })).toBe(false);
});

it('wakes readers of the written binding and of derived bindings only', () => {
  const data = {}, selected = {}, total = {};
  const writes = createSharedWrites([data, selected, total], [total]);
  const woken: string[] = [];
  for (const [name, key] of [['data', data], ['selected', selected], ['total', total]] as const) {
    const computation = createComputation(() => woken.push(name));
    computation.begin();
    trackRead(() => 0, null, key);
    computation.end();
  }
  writes.mark(data);
  expect(woken.sort()).toEqual(['data', 'total']);
});

it('skips walking a shared root its own edit notified, and finds it from an alias edit', () => {
  let walks = 0;
  const item = { label: 'a' };
  const data = new Proxy([item], {
    ownKeys(target) {
      walks++;
      return Reflect.ownKeys(target);
    },
  });
  const writes = createSharedWrites([{}], []);
  let notified = 0;
  const notify = () => { notified++; };
  writes.watch([{ read: () => data, notify }]);
  // `data[0].label = …`: the compiled edit passes `data`'s own notifier.
  mutationTarget(item, 'label', notify).value = 'b';
  expect([walks, notified]).toEqual([0, 1]);
  // The same object edited through another binding still reaches `data`.
  mutationTarget(item, 'label', () => {}).value = 'c';
  expect(walks).toBeGreaterThan(0);
  expect(notified).toBe(2);
});

it('marks a shared owner stale after any write and fresh once its refresh begins', () => {
  const key = {};
  const writes = createSharedWrites([key], []);
  expect(writes.stale()).toBe(true);
  writes.refreshing();
  expect(writes.stale()).toBe(false);
  writes.mark(key);
  expect(writes.stale()).toBe(true);
  writes.refreshing();
  mutationTarget({}, 'x', () => {}).value = 1;
  expect(writes.stale()).toBe(true);
  writes.refreshing();
  // Another owner's write can change a derivation that reads it.
  createSharedWrites([{}], []).mark();
  expect(writes.stale()).toBe(true);
});

it('keeps one dependency per key and version reader, holding the latest version seen', () => {
  let version = 0;
  const read = () => version;
  const key = {};
  const computation = createComputation();
  computation.begin();
  trackRead(read, null, key);
  version++;
  trackRead(read, null, key);
  computation.end();
  expect(computation.changed()).toBe(false);
  version++;
  expect(computation.changed()).toBe(true);
});

it('checks shared binding identities without reflecting over their unchanged data', () => {
  let walks = 0;
  let getters = 0;
  const value = new Proxy({ count: 0, get unused() { getters++; return 0; } }, {
    ownKeys(target) {
      walks++;
      return Reflect.ownKeys(target);
    },
  });
  const key = {};
  const writes = createSharedWrites([key], []);
  writes.watch([{ read: () => value, notify() {} }]);
  store(value, 'count', 1);
  expect(walks).toBeGreaterThan(0);
  walks = 0;
  const mark = writes.mark;
  mark(key);
  writes.check();
  expect(walks).toBe(0);
  expect(getters).toBe(0);
});
