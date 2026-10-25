/** Empty collectors need no disposal registration; actual subscriptions do. */
import { expect, it } from 'bun:test';
import { createComputation, publishVersions, trackRead } from '../src/computation';
import {
  createApplicationRuntime,
  getExtensionStore,
  registerEntity,
  runWithApplicationRuntime,
  unregisterSubtree,
} from '../src/kernel';

it('registers only after a computation starts subscribing, then disposes it with its entity', () => {
  const runtime = createApplicationRuntime();
  runWithApplicationRuntime(runtime, () => {
    const entity = { id: 'row', parent: null, render() {} };
    registerEntity(entity);
    let notifications = 0;
    const computation = createComputation(() => notifications++, entity);
    const owners = getExtensionStore<Map<string, Set<unknown>>>('mmd:owned-computations', () => new Map());
    expect(owners.size).toBe(0);

    computation.begin();
    computation.end();
    expect(owners.size).toBe(0);

    // A later run can discover a hidden read even when the initial run had none.
    const key = {};
    let version = 0;
    computation.begin();
    trackRead(() => version, 'value', key);
    computation.end();
    expect(owners.get(entity.id)?.size).toBe(1);
    version++;
    publishVersions([key]);
    expect(notifications).toBe(1);

    unregisterSubtree(entity.id);
    expect(owners.size).toBe(0);
    version++;
    publishVersions([key]);
    expect(notifications).toBe(1);
  });
  runtime.dispose();
});

it('keeps subscription ownership independent across applications with the same entity id', () => {
  const first = createApplicationRuntime();
  const second = createApplicationRuntime();
  const key = {};
  let version = 0;
  const notified: string[] = [];
  for (const [runtime, name] of [[first, 'first'], [second, 'second']] as const) {
    runWithApplicationRuntime(runtime, () => {
      const entity = { id: 'row', parent: null, render() {} };
      registerEntity(entity);
      const computation = createComputation(() => notified.push(name), entity);
      computation.begin();
      trackRead(() => version, 'value', key);
      computation.end();
    });
  }
  runWithApplicationRuntime(second, () => unregisterSubtree('row'));
  runWithApplicationRuntime(first, () => {
    version++;
    publishVersions([key]);
  });
  expect(notified).toEqual(['first']);
  first.dispose();
  second.dispose();
});
