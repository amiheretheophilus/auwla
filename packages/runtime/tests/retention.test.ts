/** Finished work must release payloads before deferred recovery callbacks run. */
import { expect, it, spyOn } from 'bun:test';
import { observeMutation } from '../src/mutation';
import { createComputation, publishVersions, trackRead } from '../src/computation';
import {
  createApplicationRuntime, getExtensionStore, registerEntity, runWithApplicationRuntime,
  setScheduler, unregisterSubtree,
} from '../src/kernel';
import { createWriteBatch } from '../src/write-batch';

async function collectAfterTurn(reference?: WeakRef<object>): Promise<void> {
  // WeakRef targets stay alive for the job in which they were created. Cross
  // that boundary before forcing collection; never use heap-size thresholds.
  // Collection can defer weak processing or see conservative stack roots.
  // Bound the retry count; a real queued strong reference cannot pass this.
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    if (reference === undefined || reference.deref() === undefined) {
      return;
    }
  }
}

// Keep the scheduler outside payload-producing scopes. Otherwise the fixture's
// installed callback can retain a shared lexical environment of its own.
function runImmediately(run: () => void): void {
  run();
}

it('does not retain an application registry through an empty collector', async () => {
  function completed() {
    const runtime = createApplicationRuntime();
    return runWithApplicationRuntime(runtime, () => {
      const entity = { id: 'empty-row', parent: null, render() {} };
      registerEntity(entity);
      const computation = createComputation(undefined, entity);
      computation.begin();
      computation.end();
      const owners = getExtensionStore<Map<string, Set<unknown>>>('mmd:owned-computations', () => new Map());
      const reference = new WeakRef(owners);
      runtime.dispose();
      return { computation, reference };
    });
  }
  const result = completed();
  await collectAfterTurn(result.reference);
  expect(result.reference.deref()).toBeUndefined();
  expect(result.computation.changed()).toBe(false);
  result.computation.dispose();
});

it('releases a completed row batch while its recovery is still queued', async () => {
  const runtime = createApplicationRuntime();
  const queued: (() => void)[] = [];
  const scheduler = spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => queued.push(callback));
  function completed() {
    const payload = { renders: 0 };
    const reference = new WeakRef(payload);
    runWithApplicationRuntime(runtime, () => {
      setScheduler(runImmediately);
      const entity = { id: 'row', parent: null, render: () => payload.renders++ };
      registerEntity(entity);
      const batch = createWriteBatch(entity);
      batch.activate();
      batch.listener(() => batch.mark())();
      expect(payload.renders).toBe(1);
      unregisterSubtree(entity.id);
    });
    return reference;
  }
  const reference = completed();
  scheduler.mockRestore();
  await collectAfterTurn(reference);
  const retainedBeforeRecovery = reference.deref() !== undefined;
  // Restore scheduler state before asserting, including on the failing baseline.
  for (const recover of queued) {
    recover();
  }
  runtime.dispose();
  expect(retainedBeforeRecovery).toBe(false);
});

it('releases completed observation inputs while its recovery callback is still queued', async () => {
  const queued: (() => void)[] = [];
  const scheduler = spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => queued.push(callback));
  function completed() {
    const item = { nested: { value: 1 } };
    const reference = new WeakRef(item);
    const observation = observeMutation([() => item], [() => {}]);
    expect(observation.finish(7)).toBe(7);
    return { reference, observation };
  }
  const result = completed();
  scheduler.mockRestore();
  expect(queued).toHaveLength(1);
  await collectAfterTurn(result.reference);
  expect(result.reference.deref()).toBeUndefined();
  expect(result.observation.finish(8)).toBe(8);
  for (const recover of queued) {
    recover();
  }
});

it('queues bounded recovery work for many completed calls and notification waves', () => {
  const queued: (() => void)[] = [];
  const scheduler = spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => queued.push(callback));
  const key = {};
  const computation = createComputation(() => {});
  computation.begin();
  trackRead(() => 0, 0, key);
  computation.end();
  for (let index = 0; index < 200; index++) {
    observeMutation([() => ({ value: index })], [() => {}]).finish(index);
    publishVersions([key]);
  }
  computation.dispose();
  scheduler.mockRestore();
  // One mutation recovery and one notification recovery, independent of calls.
  expect(queued).toHaveLength(2);
  for (const recover of queued) {
    recover();
  }
});

it('releases completed notification waves before their recovery callbacks run', async () => {
  const queued: (() => void)[] = [];
  const scheduler = spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => queued.push(callback));
  function completed() {
    const payload = { notified: 0 };
    const reference = new WeakRef(payload);
    const key = {};
    const computation = createComputation(() => payload.notified++);
    computation.begin();
    trackRead(() => 0, 0, key);
    computation.end();
    publishVersions([key]);
    expect(payload.notified).toBe(1);
    computation.dispose();
    return reference;
  }
  const reference = completed();
  scheduler.mockRestore();
  expect(queued.length).toBeGreaterThan(0);
  await collectAfterTurn(reference);
  expect(reference.deref()).toBeUndefined();
  for (const recover of queued) {
    recover();
  }
});

it('retains an abandoned call until partial edits have been recovered', async () => {
  const queued: (() => void)[] = [];
  const scheduler = spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => queued.push(callback));
  const item = { value: 0 };
  let notifications = 0;
  function editAndThrow(): void {
    observeMutation([() => item], [() => notifications++]);
    item.value++;
    throw new Error('native failure');
  }
  expect(editAndThrow).toThrow('native failure');
  scheduler.mockRestore();
  await collectAfterTurn();
  expect(notifications).toBe(0);
  for (const recover of queued) {
    recover();
  }
  expect(notifications).toBe(1);
});
