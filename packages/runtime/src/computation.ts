/** Dependencies reached through compiled callbacks during an opaque computation. */
import { getExtensionStore, onCommitFinished, onEntityDispose, type Entity } from './kernel';

type Version = () => number;
interface Dependency {
  readonly read: Version;
  seen: number;
}

interface Frame {
  readonly dependencies: Map<object, Dependency>;
  readonly writes: Set<object>;
  readonly previous: Frame | null;
}

interface ComputationStore {
  current: Frame | null;
  notifying: Set<() => void> | null;
}

function store(): ComputationStore {
  return getExtensionStore('mmd:computation', () => ({
    current: null,
    notifying: null,
  }));
}

const subscribers = new WeakMap<object, Set<() => void>>();

function owned() {
  return getExtensionStore('mmd:owned-computations', () => new Map<string, Set<() => void>>());
}

onEntityDispose((id) => {
  for (const dispose of owned().get(id) ?? []) {
    dispose();
  }
  owned().delete(id);
});

export function publishVersions(keys: readonly object[], written?: object): void {
  const state = store();
  if (written !== undefined) {
    state.current?.writes.add(written);
  }

  // A shared memo can publish another version while its subscriber runs. Keep
  // one notification set for the whole wave so cycles cannot notify forever.
  const outer = state.notifying === null;
  const notified = state.notifying ?? new Set<() => void>();
  state.notifying = notified;
  if (outer) {
    // A throwing subscriber skips the synchronous reset below.
    globalThis.queueMicrotask(() => {
      if (state.notifying === notified) {
        state.notifying = null;
      }
    });
  }

  const notifications = new Set<() => void>();
  for (const key of keys) {
    for (const notify of subscribers.get(key) ?? []) {
      notifications.add(notify);
    }
  }
  for (const notify of notifications) {
    if (notified.has(notify)) {
      continue;
    }
    notified.add(notify);
    notify();
  }
  if (outer) {
    state.notifying = null;
  }
}

export function trackRead<T>(version: Version, value: T, key: object = version): T {
  store().current?.dependencies.set(key, { read: version, seen: version() });
  return value;
}

export function resetComputationScope(): void {
  const state = store();
  state.current = null;
  state.notifying = null;
}

export function captureComputationScope(): () => void {
  const state = store();
  const frame = state.current;
  const notifying = state.notifying;
  return () => {
    state.current = frame;
    state.notifying = notifying;
  };
}

onCommitFinished((failed) => {
  if (failed) {
    resetComputationScope();
  }
});

export function createComputation(notify?: () => void, entity?: Entity) {
  const invalidate = notify === undefined ? undefined : () => notify();
  let dependencies = new Map<object, Dependency>();
  let writes = new Set<object>();
  const subscriptions = new Set<object>();
  let frame: Frame | null = null;
  let owner: Set<() => void> | undefined;

  const unsubscribe = () => {
    if (invalidate !== undefined) {
      for (const key of subscriptions) {
        subscribers.get(key)?.delete(invalidate);
      }
    }
    subscriptions.clear();
  };
  const dispose = () => {
    unsubscribe();
    owner?.delete(dispose);
  };

  if (entity !== undefined) {
    const owners = owned();
    const list = owners.get(entity.id) ?? new Set<() => void>();
    list.add(dispose);
    owner = list;
    owners.set(entity.id, list);
  }

  return {
    begin(reset = true) {
      if (reset) {
        dependencies = new Map();
        writes = new Set();
      }
      const state = store();
      frame = { dependencies, writes, previous: state.current };
      state.current = frame;
    },
    end(settle = true) {
      const state = store();
      if (frame !== null) {
        state.current = frame.previous;
      }
      frame = null;
      if (settle) {
        // A computation's own outputs must not become inputs that replay it.
        // Other reads of the same owner remain dependencies through their keys.
        for (const key of writes) {
          dependencies.delete(key);
        }
        for (const dependency of dependencies.values()) {
          dependency.seen = dependency.read();
        }
        if (invalidate !== undefined) {
          unsubscribe();
          for (const key of dependencies.keys()) {
            const listeners = subscribers.get(key) ?? new Set<() => void>();
            listeners.add(invalidate);
            subscribers.set(key, listeners);
            subscriptions.add(key);
          }
        }
      }
    },
    changed() {
      for (const dependency of dependencies.values()) {
        if (dependency.read() !== dependency.seen) {
          return true;
        }
      }
      return false;
    },
    dependsOn(key: object) {
      return dependencies.has(key);
    },
    dispose,
  };
}
