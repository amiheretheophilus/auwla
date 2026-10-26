import { expect, it } from 'bun:test';
import { observeHelper, observeMethod } from '../src/method-calls';
import { createRowCache } from '../src/list-map';
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

it('accepts unlisted method names and proves an intrinsic by identity through an alias', () => {
  const items = rows();
  Object.defineProperty(items, 'renameFirst', {
    value(this: { id: number }[]) { this[0]!.id = 42; },
  });
  Object.defineProperty(items, 'copyAlias', { value: Array.prototype.slice });
  const { counts, reads, notify } = watch(() => items);
  observeMethod(reads, notify, items, 'renameFirst', 0)();
  expect(items[0]!.id).toBe(42);
  expect(counts.notified).toBe(1);
  const before = counts.reads;
  expect(observeMethod(reads, notify, items, 'copyAlias', 0)(1)).toEqual(items.slice(1));
  expect(counts.reads).toBe(before);
});

it('calls a proven helper without a snapshot only while the methods it assumed are the intrinsics', () => {
  const swap = (input: { id: number }[]) => {
    const result = input.slice();
    result.splice(0, 1, result[1]!);
    return result;
  };
  const items = rows();
  const { counts, reads, notify } = watch(() => items);
  expect(observeHelper(reads, notify, [[0, 'slice']], ['splice'], swap)(items).map((row) => row.id)).toEqual([1, 1, 2, 3]);
  expect(counts).toEqual({ reads: 0, notified: 0 });
  // An own `slice` that edits its receiver: the call is observed, and the edit reported.
  Object.defineProperty(items, 'slice', {
    value(this: { id: number }[]) { this[0]!.id = 7; return Array.from(this); },
  });
  observeHelper(reads, notify, [[0, 'slice']], ['splice'], swap)(items);
  expect(counts.reads).toBeGreaterThan(0);
  expect(counts.notified).toBe(1);
  // A replaced intrinsic used on the helper's own array is observed too.
  const other = rows();
  const watched = watch(() => other);
  const splice = Array.prototype.splice;
  Array.prototype.splice = function (this: unknown[], ...args: unknown[]) { return Reflect.apply(splice, this, args); } as typeof splice;
  observeHelper(watched.reads, watched.notify, [[0, 'slice']], ['splice'], swap)(other);
  Array.prototype.splice = splice;
  expect(watched.counts.reads).toBeGreaterThan(0);
});

it('observes a helper when a converted parameter can execute authored code', () => {
  const items = rows();
  const { counts, reads, notify } = watch(() => items);
  const help = (input: { id: number }[], start: number) => input.slice(start);
  observeHelper(reads, notify, [[0, 'slice']], [], help, [1])(items, 1);
  expect(counts).toEqual({ reads: 0, notified: 0 });
  observeHelper(reads, notify, [[0, 'slice']], [], help, [1])(items, {
    valueOf() { items[0]!.id = 42; return 1; },
  });
  expect(counts.notified).toBe(1);
  expect(items[0]!.id).toBe(42);
  const call = () => observeHelper(reads, notify, [[0, 'slice']], [], help, [1])(items, {
    [Symbol.toPrimitive]() { items[0]!.id = 43; throw new Error('index conversion'); },
  });
  expect(call).toThrow('index conversion');
  recoverMutations();
  expect(counts.notified).toBe(2);
  expect(items[0]!.id).toBe(43);
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

it('rechecks species after arguments can change the receiver constructor', () => {
  const items = rows();
  const { reads, notify } = watch(() => items);
  let constructed = 0;
  class Result extends Array {
    constructor(length: number) {
      super(length);
      constructed++;
    }
  }
  const call = observeMethod(reads, notify, items, 'map', 1, createRowCache(false));
  // This is the interval between the native method read and argument completion.
  Object.defineProperty(items, 'constructor', { value: { [Symbol.species]: Result } });
  const result = call((item: { id: number }) => ({ id: item.id }));
  expect(constructed).toBe(1);
  expect(result instanceof Result).toBe(true);
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

it('tracks an object moved from an accessor into a data element by an intrinsic', () => {
  const added = { id: 10 };
  const items = [{ id: 0 }, { id: 1 }];
  let getterCalls = 0;
  Object.defineProperty(items, 0, {
    get() {
      getterCalls++;
      return added;
    },
    set() {},
    configurable: true,
  });
  let notified = 0;
  const owner = {};
  registerSharedMutationRoots(owner, [{ read: () => items, notify: () => notified++ }]);
  // Establish the reach before reverse runs. The accessor value is not an
  // own data field yet, so it is discovered only after native reverse moves it.
  mutationTarget({}, 'prime', () => {}).value = 1;
  const { reads, notify } = watch(() => items);
  observeMethod(reads, notify, items, 'reverse', 0)();
  expect(items[1]).toBe(added);
  expect(notified).toBe(1);
  mutationTarget(added, 'id', () => {}).value = 11;
  expect(notified).toBe(2);
  expect(getterCalls).toBe(1);
});

it('tracks an inherited element moved into a sparse array by an intrinsic', () => {
  const added = { id: 10 };
  const items = [, { id: 1 }];
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, 0, {
    get: () => added,
    set() {},
    configurable: true,
  });
  Object.setPrototypeOf(items, prototype);
  let notified = 0;
  const owner = {};
  registerSharedMutationRoots(owner, [{ read: () => items, notify: () => notified++ }]);
  mutationTarget({}, 'prime', () => {}).value = 1;
  const { reads, notify } = watch(() => items);
  observeMethod(reads, notify, items, 'reverse', 0)();
  expect(items[1]).toBe(added);
  mutationTarget(added, 'id', () => {}).value = 11;
  expect(notified).toBe(2);
});

it('does not register a comparator as data added by sorting', () => {
  const items = rows();
  const comparator = Object.assign((a: { id: number }, b: { id: number }) => a.id - b.id, { count: 0 });
  let notified = 0;
  const owner = {};
  registerSharedMutationRoots(owner, [{ read: () => items, notify: () => notified++ }]);
  mutationTarget({}, 'prime', () => {}).value = 1;
  const { reads, notify } = watch(() => items);
  observeMethod(reads, notify, items, 'sort', 1)(comparator);
  expect(notified).toBe(1);
  mutationTarget(comparator, 'count', () => {}).value = 1;
  expect(notified).toBe(1);
});

it('recovers aliases materialized before an intrinsic throws', () => {
  const added = { id: 10 };
  const items = rows();
  Object.defineProperty(items, 3, {
    get: () => added,
    set() { throw new Error('partial reverse'); },
    configurable: true,
  });
  let notified = 0;
  const owner = {};
  registerSharedMutationRoots(owner, [{ read: () => items, notify: () => notified++ }]);
  mutationTarget({}, 'prime', () => {}).value = 1;
  const { reads, notify } = watch(() => items);
  expect(() => observeMethod(reads, notify, items, 'reverse', 0)()).toThrow('partial reverse');
  expect(items[0]).toBe(added);
  recoverMutations();
  expect(notified).toBe(1);
  mutationTarget(added, 'id', () => {}).value = 11;
  expect(notified).toBe(2);
});
