/** Dependencies reached through compiled callbacks during an opaque computation. */
import { getExtensionStore, onCommitFinished } from './kernel';

type Version = () => number;
interface Dependency { readonly read: Version; seen: number }
interface Frame { readonly dependencies: Map<object, Dependency>; readonly previous: Frame | null }
function store() { return getExtensionStore('mmd:computation', () => ({ current: null as Frame | null })); }

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

export function createComputation() {
  let dependencies = new Map<object, Dependency>();
  let frame: Frame | null = null;
  return {
    begin(reset = true) {
      if (reset) dependencies = new Map();
      const state = store();
      frame = { dependencies, previous: state.current };
      state.current = frame;
    },
    end(settle = true) {
      const state = store();
      if (frame !== null) state.current = frame.previous;
      frame = null;
      if (settle) for (const dependency of dependencies.values()) dependency.seen = dependency.read();
    },
    changed() {
      for (const dependency of dependencies.values()) if (dependency.read() !== dependency.seen) return true;
      return false;
    },
    dependsOn(key: object) { return dependencies.has(key); },
  };
}
