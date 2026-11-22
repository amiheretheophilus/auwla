import { afterEach, beforeEach, expect, it } from 'bun:test';
import {
  createApplicationRuntime, getActiveApplicationRuntime, invalidateEntity,
  registerEntity, runWithApplicationRuntime, setActiveApplicationRuntime,
  setScheduler, type ApplicationRuntime,
} from '../packages/runtime/src/kernel';

let previous: ApplicationRuntime;
let runtime: ApplicationRuntime;
const queued: Array<() => void> = [];
let renders = 0;
beforeEach(() => {
  previous = getActiveApplicationRuntime();
  runtime = createApplicationRuntime('full-owner', { document });
  setActiveApplicationRuntime(runtime);
  setScheduler(run => { queued.push(run); });
  registerEntity({ id: 'App', parent: null, render() { renders++; } });
});
afterEach(() => {
  runtime.dispose();
  setActiveApplicationRuntime(previous);
  queued.length = 0;
  renders = 0;
});

it('batches owner updates into one commit', () => {
  invalidateEntity('App');
  invalidateEntity('App');
  expect(queued).toHaveLength(1);
  queued.shift()!();
  expect(renders).toBe(1);
});

it('ignores dead owners', () => {
  invalidateEntity('Missing');
  expect(queued).toHaveLength(0);
  invalidateEntity('App');
  queued.shift()!();
  expect(renders).toBe(1);
});

it('runs queued updates in their owner after another runtime becomes active', () => {
  const other = createApplicationRuntime('other', { document });
  try {
    runWithApplicationRuntime(other, () => registerEntity({ id: 'App', parent: null, render() { throw new Error('wrong owner'); } }));
    invalidateEntity('App');
    setActiveApplicationRuntime(other);
    queued.shift()!();
    expect(renders).toBe(1);
    expect(getActiveApplicationRuntime()).toBe(other);
  } finally { other.dispose(); }
});
