import { expect, it } from 'bun:test';
import { observeMethod } from '../src/method-calls';
import { mutationTarget, recoverMutations, registerSharedMutationRoots } from '../src/mutation';

/**
 * Observation inputs for `value`. The general path calls every read to take
 * its snapshot; a proven call reads only to confirm an edited receiver.
 */
function watch(value: () => unknown) {
  const counts = { reads: 0, notified: 0 };
  const reads = [() => { counts.reads++; return value(); }];
  const notify = [() => { counts.notified++; }];
  return { counts, reads, notify };
}

const rows = () => Array.from({ length: 4 }, (_, id) => ({ id }));
const pure = (row: { id: number }) => row.id;

it('runs a proven read-only intrinsic without a snapshot', () => {
  const items = rows();
  const { counts, reads, notify } = watch(() => items);
  expect(observeMethod(reads, notify, items, 'slice', 0)(1, 3)).toEqual(items.slice(1, 3));
  expect(observeMethod(reads, notify, items, 'concat', 0)([{ id: 9 }])).toHaveLength(5);
  expect(observeMethod(reads, notify, items, 'map', 1)(pure)).toEqual([0, 1, 2, 3]);
  expect(counts).toEqual({ reads: 0, notified: 0 });
});

it('reports a proven receiver edit without a snapshot', () => {
  const items = rows();
  const { counts, reads, notify } = watch(() => items);
  observeMethod(reads, notify, items, 'reverse', 0)();
  expect(items[0]!.id).toBe(3);
  expect(counts).toEqual({ reads: 1, notified: 1 });
  observeMethod(reads, notify, items, 'splice', 0)(1, 1);
  expect(items).toHaveLength(3);
  expect(counts.notified).toBe(2);
});

it('observes an own or replaced method, which has no proof', () => {
  const items = rows();
  const { counts, reads, notify } = watch(() => items);
  Object.defineProperty(items, 'slice', {
    value(this: { id: number }[]) { this[0]!.id = 99; return []; },
  });
  observeMethod(reads, notify, items, 'slice', 0)();
  expect(counts.notified).toBe(1);
});

it('observes a subclass, whose species constructor is authored', () => {
  let constructed = 0;
  class Rows extends Array<{ id: number }> {
    constructor(...args: any[]) { super(...args); constructed++; }
  }
  const items = Rows.from(rows()) as Rows;
  constructed = 0;
  const { counts, reads, notify } = watch(() => items);
  observeMethod(reads, notify, items, 'slice', 0)(1);
  expect(constructed).toBe(1);
  expect(counts.reads).toBeGreaterThan(0);
});

it('observes an object argument the intrinsic converts, and an unproven callback', () => {
  const items = rows();
  const { counts, reads, notify } = watch(() => items);
  const start = { valueOf() { items[0]!.id = 42; return 1; } };
  observeMethod(reads, notify, items, 'slice', 0)(start);
  expect(counts.notified).toBe(1);
  observeMethod(reads, notify, items, 'map', 0)((row: { id: number }) => { row.id++; return row; });
  expect(counts.notified).toBe(2);
});

it('observes an edit of a receiver that is not the read value itself', () => {
  const state = { list: rows() };
  const { counts, reads, notify } = watch(() => state);
  observeMethod(reads, notify, state.list, 'push', 0)({ id: 4 });
  expect(state.list).toHaveLength(5);
  expect(counts.notified).toBe(1);
  expect(counts.reads).toBeGreaterThan(1);
});

it('reads the method before the arguments, as a native call does', () => {
  const log: string[] = [];
  const target = { get run() { log.push('method'); return (value: string) => log.push(value); } };
  const { reads, notify } = watch(() => target);
  observeMethod(reads, notify, target, 'run', 0)((log.push('argument'), 'call'));
  expect(log).toEqual(['method', 'argument', 'call']);
});

it('keeps alias tracking exact after a proven receiver edit', () => {
  const items = rows();
  const removed = items[1]!;
  const kept = items[2]!;
  const added = { id: 9 };
  let notified = 0;
  registerSharedMutationRoots({}, [{ read: () => items, notify: () => { notified++; } }]);
  const { reads, notify } = watch(() => items);
  observeMethod(reads, notify, items, 'splice', 0)(1, 1, added);
  expect(notified).toBe(1);
  mutationTarget(kept, 'id', () => {}).value = 20;
  expect(notified).toBe(2);
  mutationTarget(added, 'id', () => {}).value = 21;
  expect(notified).toBe(3);
  // The removed row no longer belongs to the root.
  mutationTarget(removed, 'id', () => {}).value = 22;
  expect(notified).toBe(3);
});

it('reports a receiver edit interrupted by an exception at the next recovery', () => {
  const items = rows();
  const { counts, reads, notify } = watch(() => items);
  Object.defineProperty(items, 3, {
    get: () => 3, set: () => { throw new Error('setter'); }, configurable: true,
  });
  // Reversing writes index 0 first, then throws at index 3.
  expect(() => observeMethod(reads, notify, items, 'reverse', 0)()).toThrow('setter');
  expect(counts.notified).toBe(0);
  recoverMutations();
  expect(counts.notified).toBe(1);
  recoverMutations();
  expect(counts.notified).toBe(1);
});
