/** Index ownership must follow a root's lifetime and the data it currently reaches. */
import { afterEach, expect, it } from 'bun:test';
import {
  createApplicationRuntime,
  getExtensionStore,
  registerEntity,
  runWithApplicationRuntime,
  unregisterSubtree,
  type ApplicationRuntime,
} from '../src/kernel';
import { checkMutationRoots, mutationTarget, observeMutation, watchMutationRoots } from '../src/mutation';

const runtimes: ApplicationRuntime[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.dispose();
  }
});

function application(callback: () => void): void {
  const runtime = createApplicationRuntime();
  runtimes.push(runtime);
  runWithApplicationRuntime(runtime, callback);
}

function owner(id: string, read: () => unknown, notify: () => void = () => {}) {
  const entity = { id, parent: null, render() {} };
  registerEntity(entity);
  watchMutationRoots(entity, [{ read, notify }]);
  return entity;
}

function store(object: object, key: PropertyKey, value: unknown): void {
  mutationTarget(object, key, () => {}).value = value;
}

/** Inspect resource ownership, rather than relying on a noisy heap-size threshold. */
function holders(object: object): number {
  const index = getExtensionStore<{ holders: WeakMap<object, Set<unknown>> }>(
    'mmd:mutation-roots',
    () => { throw new Error('The fixture must register its mutation roots first.'); },
  );
  return index.holders.get(object)?.size ?? 0;
}

function indexPendingRoots(): void {
  // An unrelated observed store builds the pending index without notifying it.
  store({}, 'tick', 1);
}

it('removes index memberships when repeatedly mounting and disposing the same data', () => {
  application(() => {
    const shared = { label: 'retained by the application' };
    for (let cycle = 0; cycle < 200; cycle++) {
      owner('row', () => shared);
      indexPendingRoots();
      unregisterSubtree('row');
    }
    expect(holders(shared)).toBe(0);
  });
});

it('detaches an old graph when a mounted root changes its binding', () => {
  application(() => {
    const oldValues: object[] = [];
    let value = { nested: { count: 0 } };
    const entity = owner('row', () => value);
    indexPendingRoots();
    for (let cycle = 0; cycle < 20; cycle++) {
      oldValues.push(value, value.nested);
      value = { nested: { count: 0 } };
      checkMutationRoots(entity);
      indexPendingRoots();
    }
    expect(oldValues.every((old) => holders(old) === 0)).toBe(true);
    expect(holders(value)).toBe(1);
    expect(holders(value.nested)).toBe(1);
  });
});

it('keeps other live roots indexed when a shared alias owner is disposed', () => {
  application(() => {
    const shared = { count: 0 };
    const notices = [0, 0];
    owner('first', () => ({ shared }), () => notices[0]++);
    owner('second', () => shared, () => notices[1]++);
    indexPendingRoots();
    unregisterSubtree('first');
    store(shared, 'count', 1);
    expect(notices).toEqual([0, 1]);
    expect(holders(shared)).toBe(1);
  });
});

it('releases a completed update\'s previous graph before its lazy rebuild', () => {
  application(() => {
    const dropped = { count: 0 };
    const added = { count: 0 };
    const value = { child: dropped };
    let notices = 0;
    const entity = owner('row', () => value, () => notices++);
    indexPendingRoots();
    store(value, 'child', added);
    checkMutationRoots(entity);
    expect(holders(dropped)).toBe(0);
    // Detachment must not lose a subsequent write through the new alias.
    store(added, 'count', 1);
    expect(notices).toBe(2);
    expect(holders(added)).toBe(1);
  });
});

it('does not reattach a root disposed by a reflection trap during indexing', () => {
  application(() => {
    const value = new Proxy({}, {
      ownKeys(target) {
        unregisterSubtree('row');
        return Reflect.ownKeys(target);
      },
    });
    owner('row', () => value);
    indexPendingRoots();
    expect(holders(value)).toBe(0);
  });
});

it('releases an opaque edit\'s old memberships when its component update completes', () => {
  application(() => {
    const dropped = { count: 0 };
    const value = { child: dropped };
    let notices = 0;
    const entity = owner('row', () => value, () => notices++);
    indexPendingRoots();
    const observation = observeMutation([() => value], [() => {}]);
    value.child = { count: 1 };
    observation.finish(undefined);
    checkMutationRoots(entity);
    expect(holders(dropped)).toBe(0);
    store(value.child, 'count', 2);
    expect(notices).toBe(2);
  });
});

it('removes dropped aliases when a stale reach is rebuilt', () => {
  application(() => {
    const dropped = { count: 0 };
    const added = { count: 0 };
    const value = { child: dropped };
    let notices = 0;
    owner('row', () => value, () => notices++);
    indexPendingRoots();
    store(value, 'child', added);
    store(dropped, 'count', 1);
    store(added, 'count', 1);
    expect(notices).toBe(2);
    expect(holders(dropped)).toBe(0);
    expect(holders(added)).toBe(1);
  });
});

it('retries indexing after a reflection failure interrupted a stale reach rebuild', () => {
  application(() => {
    let fail = false;
    const gate = new Proxy({}, {
      ownKeys(target) {
        if (fail) {
          throw new Error('indexing interrupted');
        }
        return Reflect.ownKeys(target);
      },
    });
    const dropped = { count: 0 };
    const added = { count: 0 };
    // Visit the throwing part before the child, so a partial index has not yet
    // discovered the object used by the subsequent successful store.
    const value = { gate, child: dropped };
    let notices = 0;
    owner('row', () => value, () => notices++);
    indexPendingRoots();
    store(value, 'child', added);
    fail = true;
    expect(() => store(dropped, 'count', 1)).toThrow('indexing interrupted');
    fail = false;
    store(added, 'count', 1);
    expect(notices).toBe(2);
    expect(holders(dropped)).toBe(0);
    expect(holders(added)).toBe(1);
  });
});

it('leaves a root its own edit notified unwalked, and finds it from an alias edit', () => {
  application(() => {
    let walks = 0;
    const item = { label: 'a' };
    const data = new Proxy([item], {
      ownKeys(target) {
        walks++;
        return Reflect.ownKeys(target);
      },
    });
    let notices = 0;
    const edited = () => { notices++; };
    const entity = { id: 'list', parent: null, render() {} };
    registerEntity(entity);
    // Compiled edits through `data` call `edited`; the root names it as `direct`.
    watchMutationRoots(entity, [{ read: () => data, notify: () => notices++, direct: edited }]);
    mutationTarget(item, 'label', edited).value = 'b';
    expect([walks, notices]).toEqual([0, 1]);
    mutationTarget(item, 'label', () => {}).value = 'c';
    expect(walks).toBeGreaterThan(0);
    expect(notices).toBe(2);
    unregisterSubtree('list');
  });
});
