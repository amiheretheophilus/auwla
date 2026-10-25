/** Finished work must release payloads before deferred recovery callbacks run. */
import { expect, it, spyOn } from 'bun:test';
import { mutationTarget, observeMutation } from '../src/mutation';
import { createComputation, publishVersions, trackRead } from '../src/computation';
import {
  createApplicationRuntime, getExtensionStore, registerEntity, runWithApplicationRuntime,
  setScheduler, unregisterSubtree,
} from '../src/kernel';
import { createWriteBatch } from '../src/write-batch';
import { createSharedWrites } from '../src/shared-writes';
import { createRowCache } from '../src/list-map';

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
    // A successful deref keeps its target alive for that job. Perform the
    // probe in another task so its temporary cannot survive in this awaiting
    // activation and become the reason the next collection attempt fails.
    const collected = await produceInTask(() => {
      return reference === undefined || reference.deref() === undefined;
    });
    if (collected) {
      return;
    }
  }
}

// Keep the scheduler outside payload-producing scopes. Otherwise the fixture's
// installed callback can retain a shared lexical environment of its own.
function runImmediately(run: () => void): void {
  run();
}

function runProducer<T>(produce: () => T, resolve: (value: T) => void): void {
  resolve(produce());
}

function produceInTask<T>(produce: () => T): Promise<T> {
  // Keep payload-producing call frames off the awaiting test's stack. JSC can
  // otherwise retain dead temporaries in that async activation after warmup.
  return new Promise((resolve) => setTimeout(runProducer, 0, produce, resolve));
}

function rowValue(item: { id: number }): object {
  return { id: item.id };
}

it('detects a strong payload reference held by a queued callback', async () => {
  const queued: (() => void)[] = [];
  function pending() {
    const payload = { calls: 0 };
    queued.push(() => payload.calls++);
    return new WeakRef(payload);
  }
  const reference = await produceInTask(pending);
  await collectAfterTurn(reference);
  expect(reference.deref()).toBeDefined();
  queued.shift()!();
});

/** Print retainer paths on failure, without persisting a heap or its values. */
function traceWaveRetainers(target: object): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.__mmdGcProbe = target;
  const heap = Bun.generateHeapSnapshot();
  delete globals.__mmdGcProbe;
  const classes = new Map<number, string>();
  for (let offset = 0; offset < heap.nodes.length; offset += 4) {
    classes.set(heap.nodes[offset]!, heap.nodeClassNames[heap.nodes[offset + 2]!]!);
  }
  const incoming = new Map<number, { from: number; name: string }[]>();
  let payload: number | undefined;
  for (let offset = 0; offset < heap.edges.length; offset += 4) {
    const from = heap.edges[offset]!;
    const to = heap.edges[offset + 1]!;
    const type = heap.edgeTypes[heap.edges[offset + 2]!]!;
    const name = type === 'Property' || type === 'Variable'
      ? `${type}:${heap.edgeNames[heap.edges[offset + 3]!]}` : type;
    if (name === 'Property:__mmdGcProbe') {
      payload = to;
      continue;
    }
    const list = incoming.get(to) ?? [];
    list.push({ from, name });
    incoming.set(to, list);
  }
  if (payload === undefined) {
    console.log('wave-probe-not-found');
    return;
  }
  console.log('wave-direct-retainers', incoming.get(payload)?.map((edge) => `${classes.get(edge.from)} ${edge.name}`));
  const queue = [{ id: payload, path: ['payload'] }];
  const seen = new Set<number>([payload]);
  let found = 0;
  for (let index = 0; index < queue.length && index < 50_000 && found < 5; index++) {
    const current = queue[index]!;
    if (current.path.length >= 15) continue;
    for (const edge of incoming.get(current.id) ?? []) {
      const path = [...current.path, `${classes.get(edge.from)} ${edge.name}`];
      if (edge.from === 0) {
        console.log('wave-retainer-path', path.join(' <- '));
        found++;
      } else if (!seen.has(edge.from)) {
        seen.add(edge.from);
        queue.push({ id: edge.from, path });
      }
    }
  }
}

it('releases removed items while their row lookup remains alive', async () => {
  function removed() {
    const item = { id: 1 };
    const reference = new WeakRef(item);
    const cache = createRowCache(false);
    cache.map([item, item], rowValue, undefined);
    cache.map([], rowValue, undefined);
    return { cache, reference };
  }
  const result = removed();
  await collectAfterTurn(result.reference);
  expect(result.reference.deref()).toBeUndefined();
  result.cache.map([], rowValue, undefined);
});

it('releases a shared binding\'s previous data after reassignment without another mutation', async () => {
  function replaced() {
    let value = { count: 0 };
    const reference = new WeakRef(value);
    const key = {};
    const writes = createSharedWrites([key], []);
    writes.watch([{ read: () => value, notify() {} }]);
    mutationTarget(value, 'count', () => {}).value = 1;
    value = { count: 2 };
    writes.mark(key);
    return { reference, writes };
  }
  const result = replaced();
  await collectAfterTurn(result.reference);
  expect(result.reference.deref()).toBeUndefined();
  // Keep the live shared owner reachable throughout collection. Only its old
  // payload should be released, not the owner or its binding reader.
  result.writes.mark();
});

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
  const reference = await produceInTask(completed);
  scheduler.mockRestore();
  expect(queued.length).toBeGreaterThan(0);
  await collectAfterTurn(reference);
  const retained = reference.deref();
  if (retained !== undefined) traceWaveRetainers(retained);
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
