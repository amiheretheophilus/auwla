import { expect, it } from 'bun:test';
import { captureComputationScope, createComputation, trackRead } from '../src/computation';

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
