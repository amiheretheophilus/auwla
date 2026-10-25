import { expect, it } from 'bun:test';
import { captureComputationScope, createComputation, publishVersions, trackEquals, trackRead } from '../src/computation';

it('propagates shared invalidation through nested owners without recursively notifying a cycle', () => {
  const input = {}, output = {};
  let notifications = 0;
  const upstream = createComputation(() => publishVersions([input, output]));
  const downstream = createComputation(() => notifications++);
  upstream.begin(); trackRead(() => 0, 0, input); upstream.end();
  downstream.begin(); trackRead(() => 0, 0, output); downstream.end();
  publishVersions([input]);
  expect(notifications).toBe(1);
  publishVersions([input]);
  expect(notifications).toBe(2);
  upstream.dispose(); downstream.dispose();
});

it('captures executed hidden reads, settles self writes and replaces branch dependencies', () => {
  let version = 0, other = 0;
  const a = () => version, b = () => other;
  const computation = createComputation();
  computation.begin();
  expect(trackRead(a, 3)).toBe(3);
  version++;
  computation.end();
  expect(computation.changed()).toBe(false);
  version++;
  expect(computation.changed()).toBe(true);
  computation.begin();
  trackRead(b, 0);
  computation.end();
  version++;
  expect(computation.changed()).toBe(false);
  other++;
  expect(computation.changed()).toBe(true);
});

it('keeps nested collectors independent and restores the caller after failure', () => {
  let outerVersion = 0, innerVersion = 0;
  const outer = createComputation(), inner = createComputation();
  outer.begin();
  const restore = captureComputationScope();
  inner.begin();
  trackRead(() => innerVersion, 0);
  restore();
  trackRead(() => outerVersion, 0);
  outer.end();
  innerVersion++;
  expect(outer.changed()).toBe(false);
  outerVersion++;
  expect(outer.changed()).toBe(true);
});

it('retains another computation subscription when the same owner changes dependencies', () => {
  const key = {};
  let version = 0, notifications = 0;
  const notify = () => notifications++;
  const first = createComputation(notify), second = createComputation(notify);
  first.begin(); trackRead(() => version, 0, key); first.end();
  second.begin(); trackRead(() => version, 0, key); second.end();
  second.begin(); second.end();
  version++;
  publishVersions([key]);
  expect(notifications).toBe(1);
  expect(first.changed()).toBe(true);
  first.dispose(); second.dispose();
  publishVersions([key]);
  expect(notifications).toBe(1);
});

it('excludes its own mutated output while retaining another input in the same shared owner', () => {
  const input = {}, output = {};
  let inputVersion = 0, outputVersion = 0;
  const computation = createComputation();
  computation.begin();
  trackRead(() => inputVersion, 1, input);
  trackRead(() => outputVersion, [], output);
  outputVersion++;
  publishVersions([input, output], output);
  computation.end();
  outputVersion++;
  expect(computation.changed()).toBe(false);
  inputVersion++;
  expect(computation.changed()).toBe(true);
});

/** `rows` computations, each reading `selected === id` for its own id. */
function selection(rows: number) {
  const key = {};
  const state = { selected: 0 as unknown, version: 0 };
  const peek = () => state.selected;
  const version = () => state.version;
  const woken: number[] = [];
  const computations = Array.from({ length: rows }, (_, id) => {
    const computation = createComputation(() => woken.push(id));
    computation.begin();
    trackEquals(peek(), id, peek, version, key);
    computation.end();
    return computation;
  });
  const select = (value: unknown) => {
    state.selected = value;
    state.version++;
    woken.length = 0;
    publishVersions([key]);
    return [...woken].sort((a, b) => a - b);
  };
  return { key, state, peek, version, computations, select };
}

it('wakes only the readers whose comparison can flip', () => {
  const { computations, select } = selection(1000);
  expect(select(5)).toEqual([0, 5]);
  // Each woken reader re-evaluates; the others never ran again.
  expect(computations[0]!.changed()).toBe(true);
  expect(computations[5]!.changed()).toBe(true);
  expect(computations[7]!.changed()).toBe(false);
  expect(select(5)).toEqual([0, 5]);
  expect(select('none')).toEqual([0]);
});

it('tracks the comparison after the reader re-runs', () => {
  const { key, peek, version, computations, select } = selection(10);
  select(3);
  const rerun = (id: number) => {
    const computation = computations[id]!;
    computation.begin();
    trackEquals(peek(), id, peek, version, key);
    computation.end();
  };
  rerun(0);
  rerun(3);
  expect(select(4)).toEqual([3, 4]);
});

it('falls back to every change when one computation compares with two values or also reads plainly', () => {
  const key = {};
  const state = { selected: 0, version: 0 };
  const peek = () => state.selected;
  const version = () => state.version;
  let woken = 0;
  const twice = createComputation(() => woken++);
  twice.begin();
  trackEquals(peek(), 1, peek, version, key);
  trackEquals(peek(), 2, peek, version, key);
  twice.end();
  const plain = createComputation(() => woken++);
  plain.begin();
  trackEquals(peek(), 1, peek, version, key);
  trackRead(version, state.selected, key);
  plain.end();
  state.selected = 9;
  state.version++;
  publishVersions([key]);
  expect(woken).toBe(2);
  expect(twice.changed()).toBe(true);
});

it('merges keyed reads of different values shared by nested rows into a plain dependency', () => {
  const key = {};
  const state = { selected: 0, version: 0 };
  const peek = () => state.selected;
  const version = () => state.version;
  let woken = 0;
  const outer = createComputation(() => woken++);
  outer.begin();
  for (const id of [1, 2, 3]) {
    const row = createComputation();
    row.begin();
    trackEquals(peek(), id, peek, version, key);
    row.end();
    row.share();
  }
  outer.end();
  // Selecting the first row must wake the caller, not only the last row's value.
  state.selected = 1;
  state.version++;
  publishVersions([key]);
  expect(woken).toBe(1);
  expect(outer.changed()).toBe(true);
});

it('stops waking a disposed keyed reader', () => {
  const { computations, select } = selection(3);
  computations[0]!.dispose();
  expect(select(1)).toEqual([1]);
});
