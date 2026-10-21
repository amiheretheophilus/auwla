import { afterEach, describe, expect, it } from 'bun:test';
import {
  createApplicationRuntime, registerEntity, runWithApplicationRuntime, setScheduler, unregisterSubtree,
  type ApplicationRuntime, type Entity,
} from '../src/kernel';
import { createWriteBatch, flushWritesBeforeAwait } from '../src/write-batch';

const runtimes: ApplicationRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

function setup() {
  const runtime = createApplicationRuntime();
  runtimes.push(runtime);
  let renders = 0;
  const entity: Entity = { id: 'test', parent: null, render: () => { renders++; } };
  const batch = runWithApplicationRuntime(runtime, () => {
    setScheduler((run) => run());
    registerEntity(entity);
    return createWriteBatch(entity);
  });
  return { runtime, entity, batch, renders: () => renders };
}

describe('local write batches', () => {
  it('flushes all shared consumers at the outer listener boundary across applications', () => {
    const first = setup();
    const second = setup();
    first.batch.activate();
    second.batch.activate();
    const inner = second.batch.listener(() => {
      first.batch.mark();
      second.batch.mark();
    });
    first.batch.listener(() => {
      inner();
      expect(first.renders()).toBe(0);
      expect(second.renders()).toBe(0);
      second.batch.mark();
    })();
    expect(first.renders()).toBe(1);
    expect(second.renders()).toBe(1);
  });
  it('flushes before suspension even inside a nested listener and preserves the operand', () => {
    const { batch, renders } = setup();
    batch.activate();
    const operand = Promise.resolve(7);
    const inner = batch.listener(() => {
      batch.mark();
      expect(flushWritesBeforeAwait(operand)).toBe(operand);
      expect(renders()).toBe(1);
    });
    const outer = batch.listener(() => { inner(); batch.mark(); });
    outer();
    expect(renders()).toBe(2);
  });
  it('ignores setup writes and batches event writes even with an immediate scheduler', async () => {
    const { batch, renders } = setup();
    batch.mark();
    batch.activate();
    const callback = batch.listener(() => {
      batch.mark();
      batch.mark();
      expect(renders()).toBe(0);
      return 7;
    });
    expect(callback()).toBe(7);
    expect(renders()).toBe(1);
    await Promise.resolve();
    expect(renders()).toBe(1);
  });

  it('keeps nested listener writes in the outer synchronous stretch', () => {
    const { batch, renders } = setup();
    batch.activate();
    const inner = batch.listener(() => batch.mark());
    const outer = batch.listener(() => {
      inner();
      expect(renders()).toBe(0);
      batch.mark();
    });
    outer();
    expect(renders()).toBe(1);
  });

  it('preserves the native receiver, arguments and return value', () => {
    const { batch } = setup();
    const receiver = { base: 4 };
    const callback = batch.listener(function (this: typeof receiver, value: number) {
      return this.base + value;
    });
    expect(callback.call(receiver, 3)).toBe(7);
  });

  it('commits callbacks outside native event wrappers at the microtask boundary', async () => {
    const { batch, renders } = setup();
    batch.activate();
    batch.mark();
    batch.mark();
    expect(renders()).toBe(0);
    await Promise.resolve();
    expect(renders()).toBe(1);
  });

  it('preserves an exception and recovers pending writes at the next boundary', async () => {
    const { batch, renders } = setup();
    batch.activate();
    const failure = new Error('authored error');
    expect(batch.listener(() => { batch.mark(); throw failure; })).toThrow(failure);
    await Promise.resolve();
    expect(renders()).toBe(1);
    batch.listener(() => batch.mark())();
    expect(renders()).toBe(2);
  });

  it('does not send an old instance notification to a replacement with the same id', async () => {
    const { runtime, batch, renders } = setup();
    let replacementRenders = 0;
    batch.activate();
    batch.mark();
    runWithApplicationRuntime(runtime, () => {
      unregisterSubtree('test');
      registerEntity({ id: 'test', parent: null, render: () => { replacementRenders++; } });
    });
    await Promise.resolve();
    expect(renders()).toBe(0);
    expect(replacementRenders).toBe(0);
  });

  it('recovers listener depth even when the listener throws before writing', async () => {
    const { batch, renders } = setup();
    batch.activate();
    expect(batch.listener(() => { throw new Error('before'); })).toThrow('before');
    await Promise.resolve();
    batch.listener(() => batch.mark())();
    expect(renders()).toBe(1);
  });

  it('notifies the captured application when another application is active', async () => {
    const first = setup();
    const second = setup();
    first.batch.activate();
    runWithApplicationRuntime(second.runtime, () => first.batch.mark());
    await Promise.resolve();
    expect(first.renders()).toBe(1);
    expect(second.renders()).toBe(0);
  });
});
