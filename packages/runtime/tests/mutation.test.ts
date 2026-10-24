import { expect, it } from 'bun:test';
import {
  captureMutationScope, deleteMutation, mutationTarget, observeMutation, registerSharedMutationRoots,
} from '../src/mutation';

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
