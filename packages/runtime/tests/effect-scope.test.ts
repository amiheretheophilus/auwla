/** Lifecycle races and ownership cannot be established by HTML comparison alone. */
import { expect, it } from 'bun:test';
import { createBuildScope } from '../src/build-scope';
import { publishVersions, trackRead } from '../src/computation';
import { createEffectScope, ownedEffect } from '../src/effect-scope';
import { registerEffect } from '../src/effect';
import { ownCleanup } from '../src/cleanup';
import { assignRef, mountRef } from '../src/refs';
import { commit, createApplicationRuntime, getEntity, registerEntity, runWithApplicationRuntime, setScheduler, unregisterSubtree } from '../src/kernel';

function fixture() {
  const runtime = createApplicationRuntime();
  const run = <T>(callback: () => T): T => runWithApplicationRuntime(runtime, callback);
  run(() => { setScheduler(callback => callback()); registerEntity({ id: 'owner', parent: null, render() {} }); });
  return { runtime, run };
}

it('cleans obsolete async results immediately and keeps the current teardown', async () => {
  const { runtime, run } = fixture();
  const events: string[] = [];
  let version = 0;
  const key = {};
  const completions: Array<(cleanup: () => void) => void> = [];
  run(() => registerEffect('effect', 'owner', () => {
    const value = trackRead(() => version, version, key);
    events.push(`start:${value}`);
    return new Promise<() => void>(resolve => completions.push(resolve));
  }, { inputs: () => [] }));
  run(() => { version++; publishVersions([key]); });
  expect(events).toEqual(['start:0', 'start:1']);
  completions[0]!(() => events.push('old'));
  await Promise.resolve();
  expect(events).toEqual(['start:0', 'start:1', 'old']);
  completions[1]!(() => events.push('current'));
  await Promise.resolve();
  run(() => unregisterSubtree('owner'));
  expect(events).toEqual(['start:0', 'start:1', 'old', 'current']);
  runtime.dispose();
});

it('cleans an async result that arrives after its owner was removed', async () => {
  const { runtime, run } = fixture();
  let complete!: (cleanup: () => void) => void;
  let cleanups = 0;
  run(() => registerEffect('effect', 'owner', () => new Promise<() => void>(resolve => { complete = resolve; }), { inputs: () => [] }));
  run(() => unregisterSubtree('owner'));
  complete(() => cleanups++);
  await Promise.resolve();
  expect(cleanups).toBe(1);
  runtime.dispose();
  expect(cleanups).toBe(1);
});

it('drops subscriptions when an effect owner is replaced with the same id', () => {
  const { runtime, run } = fixture();
  let version = 0, oldRuns = 0, newRuns = 0;
  const key = {};
  run(() => {
    registerEffect('effect', 'owner', () => { trackRead(() => version, version, key); oldRuns++; }, { inputs: () => [] });
    registerEffect('effect', 'owner', () => { newRuns++; }, { inputs: () => [] });
    version++;
    publishVersions([key]);
  });
  expect(oldRuns).toBe(1);
  expect(newRuns).toBe(1);
  runtime.dispose();
});

it('recovers subscriptions after a callback throws without repeating its old cleanup', () => {
  const { runtime, run } = fixture();
  let version = 0;
  const key = {};
  const events: string[] = [];
  run(() => registerEffect('effect', 'owner', () => {
    const value = trackRead(() => version, version, key);
    events.push(`run:${value}`);
    if (value === 1) throw new Error('failed effect');
    return () => { events.push(`stop:${value}`); };
  }, { inputs: () => [] }));
  expect(() => run(() => { version = 1; publishVersions([key]); })).toThrow('failed effect');
  run(() => { version = 2; publishVersions([key]); commit(); });
  expect(events).toEqual(['run:0', 'stop:0', 'run:1', 'run:2']);
  runtime.dispose();
  expect(events.at(-1)).toBe('stop:2');
});

it('a helper registers into the active owner and removed loop occurrences leave once', async () => {
  const { runtime, run } = fixture();
  let size = 2;
  let version = 0;
  const key = {};
  const events: string[] = [];
  const helper = () => ownedEffect('helper', [() => { events.push('start'); return () => { events.push('stop'); }; }]);
  run(() => {
    const effects = createEffectScope('owner');
    effects.watch(0, () => {
      const count = trackRead(() => version, size, key);
      for (let index = 0; index < count; index++) helper();
    }, createBuildScope());
  });
  await Promise.resolve();
  expect(events).toEqual(['start', 'start']);
  run(() => { size = 1; version++; publishVersions([key]); });
  await Promise.resolve();
  expect(events).toEqual(['start', 'start', 'stop']);
  run(() => unregisterSubtree('owner'));
  expect(getEntity('owner')).toBeUndefined();
  expect(events).toEqual(['start', 'start', 'stop', 'stop']);
  runtime.dispose();
});

it('clears an assigned ref owned before later setup fails', () => {
  const { runtime, run } = fixture();
  let mounted: Node | undefined;
  run(() => {
    const node = document.createElement('div');
    ownCleanup('owner', mountRef(node, assignRef(() => mounted, value => { mounted = value; })));
    expect(mounted).toBe(node);
    unregisterSubtree('owner');
    expect(mounted).toBeUndefined();
  });
  runtime.dispose();
});

it('detaches early cleanup while keeping owner cleanup in reverse order', () => {
  const { runtime, run } = fixture();
  const events: string[] = [];
  run(() => {
    const first = ownCleanup('owner', () => events.push('first'));
    ownCleanup('owner', () => events.push('second'));
    first(); first();
    expect(events).toEqual(['first']);
    unregisterSubtree('owner');
    expect(events).toEqual(['first', 'second']);
  });
  runtime.dispose();
});
