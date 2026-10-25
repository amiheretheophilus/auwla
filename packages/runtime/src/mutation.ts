/** Native member targets and observation for opaque calls. */
import {
  getActiveApplicationRuntime,
  getExtensionStore,
  onEntityDispose,
  runWithApplicationRuntime,
  type Entity,
} from './kernel';

const arrayIsArray = Array.isArray;

interface Root { readonly read: () => unknown; readonly notify: () => void }
const sharedRoots = new Set<WeakRef<object>>();
const rootsOfShared = new WeakMap<object, readonly Root[]>();
export function registerSharedMutationRoots(owner: object, bindings: readonly Root[]): void {
  if (!rootsOfShared.has(owner)) sharedRoots.add(new WeakRef(owner));
  rootsOfShared.set(owner, bindings);
}
/**
 * A component root, through which the index refers to it. Disposal clears
 * `root`, so an object that outlives the component does not retain its closure.
 */
interface Slot {
  root: Root | null;
  readonly store: RootStore;
  /** Reverse memberships let disposal and reindexing remove old records exactly. */
  buckets: Set<Slot>[] | null;
}

/**
 * Component roots, indexed by the objects they reach, so a store notifies the
 * roots that hold the edited object without visiting every mounted component.
 * A component can mount one root per instance (10k rows: 10k roots).
 *
 * The index is complete for every root walked since its value last changed.
 * It may hold extras (objects a root no longer reaches), which the reach check
 * rejects. A root whose binding was reassigned has already marked its own
 * component, so it is re-checked when that component updates
 * (`checkMutationRoots`), not on every store.
 */
interface RootStore {
  readonly entities: Map<string, readonly Slot[]>;
  readonly holders: WeakMap<object, Set<Slot>>;
  /** Roots to walk before the next lookup: new, moved, or after an unknown edit. */
  readonly unwalked: Set<Slot>;
}
function roots(): RootStore {
  return getExtensionStore('mmd:mutation-roots', () => ({
    entities: new Map(), holders: new WeakMap(), unwalked: new Set(),
  }));
}
function release(store: RootStore, id: string): void {
  for (const slot of store.entities.get(id) ?? []) {
    if (slot.root !== null) {
      reaches.delete(slot.root);
    }
    slot.root = null;
    detach(slot);
    store.unwalked.delete(slot);
  }
  store.entities.delete(id);
}
onEntityDispose((id) => { release(roots(), id); });

export function watchMutationRoots(entity: Entity, bindings: readonly Root[]): void {
  const store = roots();
  release(store, entity.id);
  const slots = bindings.map((root): Slot => ({ root, store, buckets: null }));
  store.entities.set(entity.id, slots);
  for (const slot of slots) store.unwalked.add(slot);
}

/** Release a completed update's old graph; rebuild lazily before the next lookup. */
export function checkMutationRoots(entity: Entity): void {
  const store = roots();
  for (const slot of store.entities.get(entity.id) ?? []) {
    if (slot.root === null) {
      continue;
    }
    const root = slot.root;
    const known = reaches.get(root);
    if (known === undefined) {
      // Opaque edits forget the reach before notifying this component.
      // Its completed update can release the old buckets without rebuilding.
      if (store.unwalked.has(slot)) {
        detach(slot);
      }
      continue;
    }
    const changed = known.stale || !Object.is(known.value, root.read());
    if (slot.root !== root) {
      continue;
    }
    if (changed) {
      // Reverse memberships must not retain buckets for historical graphs.
      // The next lookup already knows how to rebuild an unwalked root.
      reaches.delete(root);
      detach(slot);
      store.unwalked.add(slot);
    }
  }
}

function detach(slot: Slot): void {
  if (slot.buckets === null) {
    return;
  }
  for (const bucket of slot.buckets) {
    bucket.delete(slot);
  }
  slot.buckets = null;
}

function hold(slot: Slot, object: object): void {
  // Reflection can run authored proxy traps that dispose the owner mid-walk.
  if (slot.root === null) {
    return;
  }
  let held = slot.store.holders.get(object);
  if (held === undefined) {
    held = new Set();
    slot.store.holders.set(object, held);
  }
  if (!held.has(slot)) {
    held.add(slot);
    (slot.buckets ??= []).push(held);
  }
}

/** Walk identities through data fields, without invoking an unused accessor. */
function reachable(
  value: unknown,
  visit: (object: object) => void,
  seen = new Set<object>(),
  onUntrackedRead?: () => void,
): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return;
  seen.add(value);
  visit(value);
  if (value instanceof Map) Map.prototype.forEach.call(value, (item: unknown, key: unknown) => {
    reachable(key, visit, seen, onUntrackedRead);
    reachable(item, visit, seen, onUntrackedRead);
  });
  if (value instanceof Set) {
    Set.prototype.forEach.call(value, (item: unknown) => reachable(item, visit, seen, onUntrackedRead));
  }
  const array = onUntrackedRead !== undefined && arrayIsArray(value);
  let length: unknown;
  let elements = 0;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (array) {
      if (key === 'length' && 'value' in descriptor) {
        length = descriptor.value;
      } else if (arrayIndex(key)) {
        elements++;
      }
    }
    if ('value' in descriptor) {
      reachable(descriptor.value, visit, seen, onUntrackedRead);
    } else {
      onUntrackedRead?.();
    }
  }
  // A native array method can materialize an inherited value from a hole.
  // Descriptor traversal deliberately does not read that inherited element.
  if (array && elements !== length) {
    onUntrackedRead!();
  }
}

function arrayIndex(key: PropertyKey): boolean {
  if (typeof key !== 'string') {
    return false;
  }
  const index = +key;
  return index >= 0 && index < 0xffff_ffff && index % 1 === 0 && `${index}` === key;
}

/**
 * The objects a root reached when it was last walked. Compiled edits keep the
 * set up to date: a store adds what it wrote. An edit that may drop an object
 * marks the set `stale`, since it may now hold extra objects. So a miss is
 * always exact, and a hit on a stale set is checked by walking again. Walking
 * every root on every write would cost the size of all mounted data.
 */
interface Reach {
  readonly value: unknown;
  readonly objects: WeakSet<object>;
  stale: boolean;
  /** Accessors and sparse arrays can supply values absent from data descriptors. */
  untracked: boolean;
}
const reaches = new WeakMap<Root, Reach>();

/** Shared readers return native bindings; checking identity does not walk their data. */
export function checkSharedMutationRoots(bindings: readonly Root[]): void {
  for (const root of bindings) {
    const known = reaches.get(root);
    if (known !== undefined && !Object.is(known.value, root.read())) {
      // A reassignment can be the final action in a turn, such as clearing a
      // list. Do not retain its previous graph until some later mutation.
      reaches.delete(root);
    }
  }
}

function walk(root: Root, slot?: Slot): Reach {
  if (slot !== undefined) {
    // Keep an interrupted rebuild pending. Removing old memberships must not
    // make a later write miss a root whose reflection threw partway through.
    slot.store.unwalked.add(slot);
    detach(slot);
  }
  reaches.delete(root);
  const value = root.read();
  const reach: Reach = { value, objects: new WeakSet(), stale: false, untracked: false };
  extendReach(reach, value, slot);
  reaches.set(root, reach);
  slot?.store.unwalked.delete(slot);
  return reach;
}

function extendReach(reach: Reach, value: unknown, slot?: Slot): void {
  reachable(value, (object) => {
    reach.objects.add(object);
    if (slot !== undefined) {
      hold(slot, object);
    }
  }, new Set(), () => {
    reach.untracked = true;
  });
}

/** How an edit changed the data below the objects it changed. */
type Edit =
  /** A store of `added`; `removed` when the old value may have been an object. */
  | { readonly kind: 'store'; readonly added: unknown; readonly removed: boolean }
  /** Only this argument interval is inserted by the proven array intrinsic. */
  | { readonly kind: 'receiver'; readonly added: readonly unknown[]; readonly from: number; readonly to: number }
  /** An opaque call or a setter: anything below the changed objects may differ. */
  | { readonly kind: 'unknown' };

/** Module and factory roots: one per shared binding, so few; each is checked on every edit. */
function* sharedWatchedRoots(): Generator<Root> {
  for (const reference of sharedRoots) {
    const owner = reference.deref();
    if (owner === undefined) {
      sharedRoots.delete(reference);
      continue;
    }
    yield* rootsOfShared.get(owner) ?? [];
  }
}

function reachesAny(objects: { has(object: object): boolean }, changed: ReadonlySet<object>): boolean {
  for (const object of changed) {
    if (objects.has(object)) return true;
  }
  return false;
}

/**
 * Every observed edit stamps the object it changed with a new time. A reader
 * that keeps the time it last looked at a value can then ask whether the value
 * changed in place since, without being notified of every edit: a component
 * whose parent passes the same `item` again updates only if `item` was edited.
 */
let clock = 0;
const editedAt = new WeakMap<object, number>();

function stamp(object: object): void {
  editedAt.set(object, ++clock);
}

export function mutationTime(): number {
  return clock;
}

/** Whether an observed edit since `time` changed `value` or data reachable from it. */
export function mutatedSince(value: unknown, time: number): boolean {
  if (time === clock || !isObject(value)) return false;
  return editedBelow(value, time, new Set());
}

function editedBelow(value: object, time: number, seen: Set<object>): boolean {
  if (seen.has(value)) return false;
  seen.add(value);
  if ((editedAt.get(value) ?? 0) > time) return true;
  const below = (item: unknown) => isObject(item) && editedBelow(item, time, seen);
  if (value instanceof Map) {
    let found = false;
    Map.prototype.forEach.call(value, (item: unknown, key: unknown) => {
      found ||= below(key) || below(item);
    });
    if (found) return true;
  }
  if (value instanceof Set) {
    let found = false;
    Set.prototype.forEach.call(value, (item: unknown) => {
      found ||= below(item);
    });
    if (found) return true;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if ('value' in descriptor && below(descriptor.value)) return true;
  }
  return false;
}

/** Notify every root whose data includes a changed object, then record the edit. */
function notifyAliases(changed: ReadonlySet<object>, edit: Edit): void {
  if (changed.size === 0) return;
  const callbacks = new Set<() => void>();
  const store = roots();
  for (const slot of store.unwalked) {
    if (slot.root !== null) walk(slot.root, slot);
  }
  store.unwalked.clear();
  const candidates = new Set<Slot>();
  for (const object of changed) {
    for (const slot of store.holders.get(object) ?? []) candidates.add(slot);
  }
  for (const slot of candidates) {
    if (slot.root === null) continue;
    if (notifies(slot.root, changed, edit, slot)) {
      callbacks.add(slot.root.notify);
      // After an unknown edit, walk again before the next lookup.
      if (!reaches.has(slot.root)) store.unwalked.add(slot);
    }
  }
  for (const root of sharedWatchedRoots()) {
    if (notifies(root, changed, edit)) callbacks.add(root.notify);
  }
  for (const notify of callbacks) notify();
}

/** Whether `root` reaches a changed object; keeps its reach (and index) up to date. */
function notifies(root: Root, changed: ReadonlySet<object>, edit: Edit, slot?: Slot): boolean {
  const known = reaches.get(root);
  // A root that now holds another value is walked again; that walk already
  // sees the edit.
  let reach = known !== undefined && Object.is(known.value, root.read()) ? known : walk(root, slot);
  if (!reachesAny(reach.objects, changed)) return false;
  // An edit of the root's own value is a hit however stale the rest of the set
  // is; only a hit on an object it may have dropped needs a new walk.
  if (reach === known && reach.stale && !(isObject(reach.value) && changed.has(reach.value))) {
    reach = walk(root, slot);
    if (!reachesAny(reach.objects, changed)) return false;
  } else if (reach === known) {
    record(root, reach, edit, slot);
  }
  return true;
}

function record(root: Root, reach: Reach, edit: Edit, slot?: Slot): void {
  if (edit.kind === 'unknown' || edit.kind === 'receiver' && reach.untracked) {
    // Native methods can move a getter's result into an own data element.
    // A descriptor-only reach cannot enumerate those additions in advance.
    reaches.delete(root);
    return;
  }
  // Incremental indexing can encounter the same reflection failures as a full
  // walk. A successful update clears this guard; a throw leaves a full retry.
  slot?.store.unwalked.add(slot);
  if (edit.kind === 'receiver') {
    // Do not index the temporary arguments array, converting parameters or a
    // comparator: none of those containers become data owned by the receiver.
    for (let index = edit.from; index < edit.to; index++) {
      extendReach(reach, edit.added[index], slot);
    }
  } else {
    extendReach(reach, edit.added, slot);
  }
  slot?.store.unwalked.delete(slot);
  if (edit.kind === 'receiver' || edit.removed) reach.stale = true;
}

function isObject(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

/**
 * What storing at `object[key]` will do to the data, read before the store.
 * Descriptors are read so that no getter runs; a setter can do anything.
 */
function storeEdit(object: object, key: PropertyKey, value: unknown): Edit {
  // Shrinking an array drops its elements without touching their descriptors.
  if (Array.isArray(object) && key === 'length') return { kind: 'store', added: undefined, removed: true };
  for (let owner: object | null = object; owner !== null; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor === undefined) continue;
    if (!('value' in descriptor)) return { kind: 'unknown' };
    // An inherited data field is shadowed by a new own field.
    const removed = owner === object && isObject(descriptor.value);
    return { kind: 'store', added: value, removed };
  }
  return { kind: 'store', added: value, removed: false };
}

/**
 * One object's own state, with child objects by identity. Data descriptors
 * avoid running getters merely to check for a mutation.
 */
function snapshot(object: object): unknown[] {
  const result: unknown[] = [object, Object.getPrototypeOf(object)];
  if (object instanceof Map) {
    result.push('map', object.size);
    Map.prototype.forEach.call(object, (value: unknown, key: unknown) => result.push(key, value));
  } else if (object instanceof Set) {
    result.push('set', object.size);
    Set.prototype.forEach.call(object, (item: unknown) => result.push(item));
  } else if (object instanceof Date) {
    result.push(Date.prototype.getTime.call(object));
  } else if (ArrayBuffer.isView(object)) {
    const bytes = new Uint8Array(object.buffer, object.byteOffset, object.byteLength);
    result.push(bytes.length, ...bytes);
  } else if (object instanceof ArrayBuffer) {
    result.push(object.byteLength, ...new Uint8Array(object));
  }
  const keys = Reflect.ownKeys(object);
  result.push(keys.length);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
    result.push(key, descriptor.enumerable, descriptor.configurable);
    if ('value' in descriptor) result.push(descriptor.writable, descriptor.value);
    else result.push(descriptor.get, descriptor.set);
  }
  return result;
}

interface Observation { finish<T>(result: T): T; recover(): void }
interface MutationStore {
  readonly pending: Set<WeakRef<Observation>>;
  readonly unrecovered: Map<WeakRef<Observation>, Observation>;
  queued: boolean;
}

function mutationStore(): MutationStore {
  return getExtensionStore('mmd:mutations', () => ({
    pending: new Set(),
    unrecovered: new Map(),
    queued: false,
  }));
}

function recoverObservation(state: MutationStore, reference: WeakRef<Observation>): void {
  const observation = state.unrecovered.get(reference) ?? reference.deref();
  if (observation === undefined) {
    state.pending.delete(reference);
  } else {
    observation.recover();
  }
  state.unrecovered.delete(reference);
}

function recoverPending(state: MutationStore): void {
  for (const reference of state.pending) {
    recoverObservation(state, reference);
  }
}

export function recoverMutations(): void {
  recoverPending(mutationStore());
}

/** One task recovery per application; successful calls leave no payload behind. */
function scheduleRecovery(): void {
  const state = mutationStore();
  if (state.queued || state.pending.size === 0) {
    return;
  }
  const runtime = getActiveApplicationRuntime();
  state.queued = true;
  globalThis.queueMicrotask(() => {
    state.queued = false;
    runWithApplicationRuntime(runtime, () => recoverPending(state));
  });
}

export function resumeMutations(): void {
  scheduleRecovery();
}

export function captureMutationScope(): () => void {
  const state = mutationStore();
  const pending = state.pending;
  const before = new Set(pending);
  return () => {
    for (const reference of pending) {
      if (!before.has(reference)) {
        recoverObservation(state, reference);
      }
    }
  };
}

function differs(prior: readonly unknown[], after: readonly unknown[]): boolean {
  return prior.length !== after.length || prior.some((value, i) => !Object.is(value, after[i]));
}

/**
 * A read's data changed exactly when one of the objects it reached changed
 * shallowly, or the read now gives another value. So one shallow snapshot per
 * reached object answers both questions: which reads to notify, and which
 * objects other roots may share.
 */
export function observeMutation(reads: readonly (() => unknown)[], notify: readonly (() => void)[]): Observation {
  let activeReads = reads;
  let notifications = notify;
  let values: unknown[] = [];
  let reached: Set<object>[] = [];
  const objects = new Map<object, unknown[]>();
  function observe(): void {
    values = activeReads.map((read) => read());
    reached = values.map((value) => {
      const found = new Set<object>();
      reachable(value, (object) => {
        found.add(object);
        if (!objects.has(object)) objects.set(object, snapshot(object));
      });
      return found;
    });
  }
  observe();

  const state = mutationStore();
  const pending = state.pending;
  let complete = false;
  const observation: Observation & { check(final: boolean): void } = {
    finish(result) {
      if (complete) return result;
      this.check(true);
      complete = true;
      pending.delete(reference);
      state.unrecovered.delete(reference);
      // A caller may retain this completed handle, and many calls can finish
      // before the task yields. Neither case should retain observed data or
      // the callbacks that close over it until deferred recovery runs.
      activeReads = [];
      notifications = [];
      values = [];
      reached = [];
      objects.clear();
      return result;
    },
    recover() {
      this.check(false);
    },
    check(final) {
      if (complete) return;
      const changed = new Set<object>();
      for (const [object, prior] of objects) {
        const after = snapshot(object);
        if (differs(prior, after)) changed.add(object);
        objects.set(object, after);
      }
      // Stamp before notifying: a notified owner can update synchronously.
      for (const object of changed) stamp(object);
      let moved = false;
      activeReads.forEach((read, index) => {
        const value = read();
        const replaced = !Object.is(value, values[index]);
        moved ||= replaced;
        if (replaced || reachesAny(reached[index]!, changed)) notifications[index]!();
      });
      // A later recovery compares with what each read reaches now.
      if (!final && (moved || changed.size > 0)) observe();
      notifyAliases(changed, { kind: 'unknown' });
    },
  };
  const reference = new WeakRef(observation);
  pending.add(reference);
  // An exception can abandon the native call before finish. Keep its observer
  // alive until its first recovery, even if GC runs before that boundary. An
  // awaiting call keeps its own handle alive after recovery through native JS.
  state.unrecovered.set(reference, observation);
  // A call that throws cannot execute finish. Preserve completed edits at the
  // next boundary; authored catches perform the same recovery synchronously.
  scheduleRecovery();
  return observation;
}

/**
 * A call proven to edit only `object`, which every read returns
 * (`method-calls.ts`). No snapshot: it reports `object` as an observation that
 * found it changed would. A call that throws stays pending, so its partial
 * edit is reported at the next recovery, as for any observation.
 *
 * Dense data arrays add only the indicated argument values. A root containing
 * accessors or sparse arrays forgets its reach: a native read can materialize a
 * value absent from its data descriptors. Partial calls still recover normally.
 */
export function observeReceiverEdit(
  object: object,
  notify: readonly (() => void)[],
  added: readonly unknown[],
  from = 0,
  to = added.length,
): Observation {
  const state = mutationStore();
  let complete = false;
  const report = () => {
    if (complete) return;
    complete = true;
    state.pending.delete(reference);
    state.unrecovered.delete(reference);
    stamp(object);
    for (const callback of notify) callback();
    notifyAliases(new Set([object]), { kind: 'receiver', added, from, to });
  };
  const observation: Observation = {
    finish(result) {
      report();
      return result;
    },
    recover: report,
  };
  const reference = new WeakRef(observation);
  state.pending.add(reference);
  state.unrecovered.set(reference, observation);
  scheduleRecovery();
  return observation;
}

export function mutationTarget(object: any, key: any, notify: () => void) {
  // Computed property names perform ToPropertyKey before evaluating the RHS.
  const property = Reflect.ownKeys({ [key]: 0 })[0]!;
  return {
    get value() { return object[property]; },
    set value(value: unknown) {
      const edit = storeEdit(object, property, value);
      object[property] = value;
      stamp(object);
      notify();
      notifyAliases(new Set([object]), edit);
    },
  };
}

export function deleteMutation(object: any, key: any, notify: () => void): boolean {
  const result = delete object[key];
  stamp(object);
  notify();
  notifyAliases(new Set([object]), { kind: 'store', added: undefined, removed: true });
  return result;
}

/** Private and super references stay lexically inside their declaring class. */
export function receiverMutationTarget(read: () => any, write: (value: any) => void, object: object) {
  return {
    get value() { return read(); },
    set value(value: unknown) {
      write(value);
      stamp(object);
      // Reading the old value could run a private or inherited getter.
      notifyAliases(new Set([object]), { kind: 'store', added: value, removed: true });
    },
  };
}
