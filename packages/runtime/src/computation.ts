/** Dependencies reached through compiled callbacks during an opaque computation. */
import { getExtensionStore, onCommitFinished, onEntityDispose, type Entity } from './kernel';

type Version = () => number;
interface Dependency { readonly read: Version; seen: number }
interface Frame { readonly dependencies: Map<object, Dependency>; readonly writes: Set<object>; readonly previous: Frame | null }
function store() { return getExtensionStore('mmd:computation', () => ({ current: null as Frame | null })); }
const subscribers = new WeakMap<object, Set<() => void>>();
function owned() { return getExtensionStore('mmd:owned-computations', () => new Map<string, Set<() => void>>()); }
onEntityDispose((id) => {
  for (const dispose of owned().get(id) ?? []) dispose();
  owned().delete(id);
});

export function publishVersions(keys: readonly object[], written?: object): void {
  if (written !== undefined) store().current?.writes.add(written);
  const notifications = new Set<() => void>();
  for (const key of keys) for (const notify of subscribers.get(key) ?? []) notifications.add(notify);
  for (const notify of notifications) notify();
}

export function trackRead<T>(version: Version, value: T, key: object = version): T {
  store().current?.dependencies.set(key, { read: version, seen: version() });
  return value;
}

export function resetComputationScope(): void { store().current = null; }

export function captureComputationScope(): () => void {
  const state = store();
  const frame = state.current;
  return () => { state.current = frame; };
}

onCommitFinished((failed) => { if (failed) store().current = null; });

export function createComputation(notify?: () => void, entity?: Entity) {
  const invalidate = notify === undefined ? undefined : () => notify();
  let dependencies = new Map<object, Dependency>();
  let writes = new Set<object>();
  const subscriptions = new Set<object>();
  let frame: Frame | null = null;
  const dispose = () => {
    if (invalidate !== undefined) for (const key of subscriptions) subscribers.get(key)?.delete(invalidate);
    subscriptions.clear();
  };
  if (entity !== undefined) {
    const owners = owned();
    const list = owners.get(entity.id) ?? new Set<() => void>();
    list.add(dispose);
    owners.set(entity.id, list);
  }
  return {
    begin(reset = true) {
      if (reset) { dependencies = new Map(); writes = new Set(); }
      const state = store();
      frame = { dependencies, writes, previous: state.current };
      state.current = frame;
    },
    end(settle = true) {
      const state = store();
      if (frame !== null) state.current = frame.previous;
      frame = null;
      if (settle) {
        for (const key of writes) dependencies.delete(key);
        for (const dependency of dependencies.values()) dependency.seen = dependency.read();
        if (invalidate !== undefined) {
          dispose();
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
      for (const dependency of dependencies.values()) if (dependency.read() !== dependency.seen) return true;
      return false;
    },
    dependsOn(key: object) { return dependencies.has(key); },
    dispose,
  };
}
