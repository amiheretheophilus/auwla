import { expect, it } from 'bun:test';
import { captureComputationScope, createComputation, publishVersions, trackRead } from '../src/computation';

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
