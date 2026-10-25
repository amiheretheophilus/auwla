/** Dependencies reached through compiled callbacks during an opaque computation. */
import { getExtensionStore, onCommitFinished, onEntityDispose, type Entity } from './kernel';

type Version = () => number;
interface Dependency {
  readonly read: Version;
  seen: number;
}

/** A running computation. Maps and sets are created on first use: most sites track nothing. */
interface Frame {
  dependencies: Map<object, Dependency> | null;
  writes: Set<object> | null;
  previous: Frame | null;
}

interface ComputationStore {
  current: Frame | null;
  notifying: Set<Computation> | null;
  queuedRecovery: boolean;
}

function store(): ComputationStore {
  return getExtensionStore('mmd:computation', () => ({
    current: null,
    notifying: null,
    queuedRecovery: false,
  }));
}

const subscribers = new WeakMap<object, Set<Computation>>();

function owned() {
  return getExtensionStore('mmd:owned-computations', () => new Map<string, Set<Computation>>());
}

/** Create the callback outside a notification wave's lexical environment. */
function scheduleRecovery(state: ComputationStore): void {
  if (state.queuedRecovery) {
    return;
  }
  state.queuedRecovery = true;
  globalThis.queueMicrotask(() => {
    state.queuedRecovery = false;
    state.notifying = null;
  });
}

onEntityDispose((id) => {
  for (const computation of owned().get(id) ?? []) {
    computation.dispose();
  }
  owned().delete(id);
});

export function publishVersions(keys: readonly object[], written?: object): void {
  const state = store();
  if (written !== undefined && state.current !== null) {
    (state.current.writes ??= new Set()).add(written);
  }

  // A shared memo can publish another version while its subscriber runs. Keep
  // one notification set for the whole wave so cycles cannot notify forever.
  const outer = state.notifying === null;
  const notified = state.notifying ?? new Set<Computation>();
  state.notifying = notified;
  if (outer) {
    // A throwing subscriber skips the synchronous reset below. Recover once
    // per application task, without capturing this wave's subscriber set.
    scheduleRecovery(state);
  }

  const notifications = new Set<Computation>();
  for (const key of keys) {
    for (const computation of subscribers.get(key) ?? []) {
      notifications.add(computation);
    }
  }
  for (const computation of notifications) {
    if (notified.has(computation)) {
      continue;
    }
    notified.add(computation);
    const notify = computation.notify!;
    notify();
  }
  if (outer) {
    state.notifying = null;
  }
}

export function trackRead<T>(version: Version, value: T, key: object = version): T {
  const current = store().current;
  if (current !== null) (current.dependencies ??= new Map()).set(key, { read: version, seen: version() });
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

/**
 * One site's or memo's tracked reads. A class, not closures, and maps created
 * on first use: a component row creates several, most of which track nothing.
 * A computation runs as its own frame; it is never begun again while running.
 */
class Computation implements Frame {
  dependencies: Map<object, Dependency> | null = null;
  writes: Set<object> | null = null;
  previous: Frame | null = null;
  private running = false;
  private subscriptions: object[] | null = null;
  private owner: Set<Computation> | undefined;

  constructor(readonly notify: (() => void) | undefined, entity: Entity | undefined) {
    if (entity !== undefined) {
      const owners = owned();
      let list = owners.get(entity.id);
      if (list === undefined) owners.set(entity.id, list = new Set());
      list.add(this);
      this.owner = list;
    }
  }

  begin(reset = true): void {
    if (reset) {
      this.dependencies = null;
      this.writes = null;
    }
    const state = store();
    this.previous = state.current;
    this.running = true;
    state.current = this;
  }

  end(settle = true): void {
    if (this.running) {
      store().current = this.previous;
      this.running = false;
    }
    this.previous = null;
    if (!settle) return;
    const dependencies = this.dependencies;
    if (dependencies !== null) {
      // A computation's own outputs must not become inputs that replay it.
      // Other reads of the same owner remain dependencies through their keys.
      if (this.writes !== null) {
        for (const key of this.writes) dependencies.delete(key);
      }
      for (const dependency of dependencies.values()) dependency.seen = dependency.read();
    }
    if (this.notify === undefined) return;
    this.unsubscribe();
    if (dependencies === null || dependencies.size === 0) return;
    const subscriptions: object[] = [];
    for (const key of dependencies.keys()) {
      let listeners = subscribers.get(key);
      if (listeners === undefined) subscribers.set(key, listeners = new Set());
      listeners.add(this);
      subscriptions.push(key);
    }
    this.subscriptions = subscriptions;
  }

  changed(): boolean {
    if (this.dependencies === null) return false;
    for (const dependency of this.dependencies.values()) {
      if (dependency.read() !== dependency.seen) return true;
    }
    return false;
  }

  dependsOn(key: object): boolean {
    return this.dependencies?.has(key) ?? false;
  }

  /**
   * Report this computation's dependencies to the one running around it. A
   * nested computation that skipped its work this time still makes the outer
   * one depend on what that work read.
   */
  share(): void {
    const current = store().current;
    if (current === null || this.dependencies === null) return;
    const target = current.dependencies ??= new Map();
    for (const [key, dependency] of this.dependencies) {
      target.set(key, { read: dependency.read, seen: dependency.read() });
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.owner?.delete(this);
  }

  private unsubscribe(): void {
    if (this.subscriptions === null) return;
    for (const key of this.subscriptions) subscribers.get(key)?.delete(this);
    this.subscriptions = null;
  }
}

export function createComputation(notify?: () => void, entity?: Entity) {
  return new Computation(notify, entity);
}
