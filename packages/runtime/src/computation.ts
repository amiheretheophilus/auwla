/** Dependencies reached through compiled callbacks during an opaque computation. */
import { getExtensionStore, onCommitFinished, onEntityDispose, type Entity } from './kernel';
import { advanceWriteEpoch } from './write-epoch';
import { recoveryHooks } from './recovery-hooks';

type Version = () => number;
interface Dependency {
  readonly read: Version;
  seen: number;
  /** A keyed dependency: only whether `value() === equals` matters (`trackEquals`). */
  readonly keyed?: { readonly value: () => unknown; readonly equals: unknown; readonly version: Version };
}

/**
 * Computations that read a key only through `value === k`, by `k`. Changing the
 * value from `a` to `b` can flip the comparison only where `k` is `a` or `b`. So
 * a publish notifies those keyed by the new value plus those that matched
 * before (`matched`), not every reader: selecting one of 10k rows wakes two.
 */
interface KeyedIndex {
  readonly value: () => unknown;
  readonly byValue: Map<unknown, Set<Computation>>;
  readonly matched: Set<Computation>;
}
const keyedIndexes = new WeakMap<object, KeyedIndex>();

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

type OwnedComputations = Map<string, Set<Computation>>;

function owned(): OwnedComputations {
  return getExtensionStore('mmd:owned-computations', () => new Map<string, Set<Computation>>());
}

function ownershipReference(): WeakRef<OwnedComputations> {
  // Share one weak handle per application. Keeping an empty collector alive
  // must not retain every other collector through the application's registry.
  return getExtensionStore('mmd:computation-ownership-reference', () => new WeakRef(owned()));
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

/**
 * The running computation assigned `written` while building it, which publishes nothing. It is
 * still an output: `s = s || {}` must not depend on `s`, or a later edit of `s` would replay it.
 */
export function noteOwnOutput(written: object): void {
  const current = store().current;
  if (current !== null) (current.writes ??= new Set()).add(written);
}

export function publishVersions(keys: readonly object[], written?: object): void {
  advanceWriteEpoch();
  if (written !== undefined) noteOwnOutput(written);
  const state = store();

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
    const keyed = keyedIndexes.get(key);
    if (keyed !== undefined) {
      for (const computation of keyed.matched) notifications.add(computation);
      for (const computation of keyed.byValue.get(keyed.value()) ?? []) notifications.add(computation);
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

/**
 * Whether a computation is running, so a read would be recorded. A library that follows its own
 * state for compiled code (`router/src/route-reads.ts`) sets nothing up for reads nobody follows.
 */
export function tracking(): boolean {
  return store().current !== null;
}

/**
 * `read()`, recording nothing in the running computation. The compiler reads the state an edit
 * changes this way (`lifecycle` in `lifecycle.push(x)`): finding the object to edit is not a read
 * of what it holds, and an effect that only writes some state must not depend on it and re-run
 * itself (`wiki/compiler/handlers.md`, "Edits are not reads").
 */
export function untracked<T>(read: () => T): T {
  const state = store();
  const current = state.current;
  if (current === null) return read();
  state.current = null;
  try {
    return read();
  } finally {
    state.current = current;
  }
}

export function trackRead<T>(version: Version, value: T, key: object = version): T {
  const current = store().current;
  if (current === null) return value;
  const dependencies = current.dependencies ??= new Map();
  const existing = dependencies.get(key);
  // Rows of one list read the same binding thousands of times in one frame.
  // The latest read sets what the computation saw, as a new record would.
  if (existing !== undefined && existing.read === version && existing.keyed === undefined) {
    existing.seen = version();
  } else {
    dependencies.set(key, { read: version, seen: version() });
  }
  return value;
}

/**
 * Module namespaces reached by `import()`, and how to observe each. A native namespace reports
 * no reads and can sit in any variable, so a property read of a value the compiler cannot
 * identify asks here first (`wiki/compiler/linking.md`, "A namespace from import()").
 */
const namespaces = new WeakMap<object, () => void>();

export function observeNamespace(namespace: object, observe: () => void): void {
  namespaces.set(namespace, observe);
}

/** Returns `value`. A `WeakMap` gives nothing for a key that is not an object. */
export function readNamespace<T>(value: T): T {
  namespaces.get(value as object)?.();
  return value;
}

/**
 * `value === other`, where `value` was just read from `peek` (the binding behind
 * `key`). The running computation depends only on the result, so it is notified
 * only when the value becomes or stops being `other` (`KeyedIndex`). A second
 * comparison with another `other`, or a plain read, of the same key in one
 * computation falls back to a plain dependency on `version`.
 */
export function trackEquals(value: unknown, other: unknown, peek: () => unknown, version: Version, key: object): boolean {
  const result = value === other;
  const current = store().current;
  if (current === null) return result;
  // A plain dependency on the key already covers this comparison (`depend`),
  // so thousands of rows comparing one key allocate nothing after the merge.
  const existing = current.dependencies?.get(key);
  if (existing !== undefined && existing.keyed === undefined) return result;
  depend(current, key, {
    read: () => (peek() === other ? 1 : 0), seen: result ? 1 : 0, keyed: { value: peek, equals: other, version },
  });
  return result;
}

/**
 * Add `dependency` on `key` to `frame`. One frame holds one dependency per key:
 * a plain read replaces it, a keyed read adds nothing to an existing plain one,
 * and keyed reads of two different values merge into a plain dependency on the
 * key's version, which wakes on any change.
 */
function depend(frame: Frame, key: object, dependency: Dependency): void {
  const dependencies = frame.dependencies ??= new Map();
  const existing = dependencies.get(key);
  if (existing === undefined || dependency.keyed === undefined) {
    dependencies.set(key, dependency);
  } else if (existing.keyed !== undefined && !Object.is(existing.keyed.equals, dependency.keyed.equals)) {
    const version = existing.keyed.version;
    dependencies.set(key, { read: version, seen: version() });
  }
}

/**
 * Whether a value the running computation read has changed since it last settled. Only a
 * computation begun without a reset (`begin(false)`) still holds its reads while it runs
 * (`whenQuiet` in `row-list.ts`).
 */
export function runningReadsChanged(): boolean {
  const dependencies = store().current?.dependencies;
  if (dependencies == null) return false;
  for (const dependency of dependencies.values()) {
    if (dependency.read() !== dependency.seen) return true;
  }
  return false;
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

recoveryHooks.resetComputations = resetComputationScope;
recoveryHooks.captureComputations = captureComputationScope;

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
  private keyedSubscriptions: { readonly index: KeyedIndex; readonly equals: unknown }[] | null = null;
  private owner: Set<Computation> | undefined;
  private readonly owners: WeakRef<OwnedComputations> | undefined;
  private readonly entityId: string | undefined;

  constructor(
    readonly notify: (() => void) | undefined,
    entity: Entity | undefined,
    private readonly keepsOwnWrites = false,
  ) {
    // Capture the creating application's registry, but do not register an
    // empty collector. Prop-guarded row sites often discover no hidden reads.
    this.owners = entity === undefined ? undefined : ownershipReference();
    this.entityId = entity?.id;
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
      // An effect keeps them (`createComputation`): only the write it just made is settled below.
      if (this.writes !== null && !this.keepsOwnWrites) {
        for (const key of this.writes) dependencies.delete(key);
      }
      for (const dependency of dependencies.values()) dependency.seen = dependency.read();
    }
    if (this.notify === undefined) return;
    this.unsubscribe();
    if (dependencies === null || dependencies.size === 0) return;
    if (!this.ownSubscriptions()) return;
    const subscriptions: object[] = [];
    for (const [key, dependency] of dependencies) {
      if (dependency.keyed !== undefined) {
        this.subscribeKeyed(key, dependency);
        continue;
      }
      let listeners = subscribers.get(key);
      if (listeners === undefined) subscribers.set(key, listeners = new Set());
      listeners.add(this);
      subscriptions.push(key);
    }
    this.subscriptions = subscriptions;
  }

  private ownSubscriptions(): boolean {
    if (this.entityId === undefined || this.owner !== undefined) {
      return true;
    }
    const owners = this.owners?.deref();
    if (owners === undefined) {
      return false;
    }
    // Register before subscribing, so abandoning setup before the compiler's
    // cleanup callback exists still removes every installed subscription.
    let list = owners.get(this.entityId);
    if (list === undefined) {
      list = new Set();
      owners.set(this.entityId, list);
    }
    list.add(this);
    this.owner = list;
    return true;
  }

  private subscribeKeyed(key: object, dependency: Dependency): void {
    const { value, equals } = dependency.keyed!;
    let index = keyedIndexes.get(key);
    if (index === undefined) keyedIndexes.set(key, index = { value, byValue: new Map(), matched: new Set() });
    let readers = index.byValue.get(equals);
    if (readers === undefined) index.byValue.set(equals, readers = new Set());
    readers.add(this);
    if (dependency.seen === 1) index.matched.add(this);
    (this.keyedSubscriptions ??= []).push({ index, equals });
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
    // Keyed reads stay keyed; the same key compared with another value in a
    // sibling (another row) merges into a plain dependency (`depend`). A plain
    // dependency already there covers a keyed one: nothing to add.
    for (const [key, dependency] of this.dependencies) {
      const existing = current.dependencies?.get(key);
      if (dependency.keyed !== undefined && existing !== undefined && existing.keyed === undefined) continue;
      depend(current, key, { ...dependency, seen: dependency.read() });
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.owner?.delete(this);
  }

  private unsubscribe(): void {
    if (this.subscriptions !== null) {
      for (const key of this.subscriptions) subscribers.get(key)?.delete(this);
      this.subscriptions = null;
    }
    if (this.keyedSubscriptions !== null) {
      for (const { index, equals } of this.keyedSubscriptions) {
        const readers = index.byValue.get(equals);
        readers?.delete(this);
        if (readers?.size === 0) index.byValue.delete(equals);
        index.matched.delete(this);
      }
      this.keyedSubscriptions = null;
    }
  }
}

/**
 * `keepsOwnWrites`: an effect keeps depending on what it reads even when it also writes it. Its own
 * write cannot run it again (its dependencies record the values it leaves, and it ignores
 * notifications while it runs), but a later write by anything else must: `seen(log.length); if
 * (log.length === 1) log.push('auto')` still sees the next push. A derivation drops what it writes
 * (`end`), so `s = s || {}` never replays when `s` changes.
 */
export function createComputation(notify?: () => void, entity?: Entity, keepsOwnWrites = false) {
  return new Computation(notify, entity, keepsOwnWrites);
}
