/** Native member targets and observation for opaque calls. */
import { getExtensionStore, onEntityDispose, type Entity } from './kernel';

interface Root { readonly read: () => unknown; readonly notify: () => void }
const sharedRoots = new Set<WeakRef<object>>();
const rootsOfShared = new WeakMap<object, readonly Root[]>();
export function registerSharedMutationRoots(owner: object, bindings: readonly Root[]): void {
  if (!rootsOfShared.has(owner)) sharedRoots.add(new WeakRef(owner));
  rootsOfShared.set(owner, bindings);
}
function roots() {
  return getExtensionStore('mmd:mutation-roots', () => new Map<string, { entity: Entity; roots: readonly Root[] }>());
}
onEntityDispose((id) => { roots().delete(id); });

export function watchMutationRoots(entity: Entity, bindings: readonly Root[]): void {
  roots().set(entity.id, { entity, roots: bindings });
}

/** Walk identities through data fields, without invoking an unused accessor. */
function reachable(value: unknown, visit: (object: object) => void, seen = new Set<object>()): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return;
  seen.add(value);
  visit(value);
  if (value instanceof Map) Map.prototype.forEach.call(value, (item: unknown, key: unknown) => {
    reachable(key, visit, seen); reachable(item, visit, seen);
  });
  if (value instanceof Set) Set.prototype.forEach.call(value, (item: unknown) => reachable(item, visit, seen));
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if ('value' in descriptor) reachable(descriptor.value, visit, seen);
  }
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
}
const reaches = new WeakMap<Root, Reach>();

function walk(root: Root): Reach {
  const value = root.read();
  const objects = new WeakSet<object>();
  reachable(value, (object) => objects.add(object));
  const reach: Reach = { value, objects, stale: false };
  reaches.set(root, reach);
  return reach;
}

/** How an edit changed the data below the objects it changed. */
type Edit =
  /** A store of `added`; `removed` when the old value may have been an object. */
  | { readonly kind: 'store'; readonly added: unknown; readonly removed: boolean }
  /** An opaque call or a setter: anything below the changed objects may differ. */
  | { readonly kind: 'unknown' };

function* watchedRoots(): Generator<Root> {
  for (const entry of roots().values()) yield* entry.roots;
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

/** Notify every root whose data includes a changed object, then record the edit. */
function notifyAliases(changed: ReadonlySet<object>, edit: Edit): void {
  if (changed.size === 0) return;
  const callbacks = new Set<() => void>();
  for (const root of watchedRoots()) {
    const known = reaches.get(root);
    // A root that now holds another value is walked again; that walk already
    // sees the edit.
    let reach = known !== undefined && Object.is(known.value, root.read()) ? known : walk(root);
    if (!reachesAny(reach.objects, changed)) continue;
    if (reach === known && reach.stale) {
      reach = walk(root);
      if (!reachesAny(reach.objects, changed)) continue;
    } else if (reach === known) {
      record(root, reach, edit);
    }
    callbacks.add(root.notify);
  }
  for (const notify of callbacks) notify();
}

function record(root: Root, reach: Reach, edit: Edit): void {
  if (edit.kind === 'unknown') {
    reaches.delete(root);
    return;
  }
  reachable(edit.added, (object) => reach.objects.add(object));
  if (edit.removed) reach.stale = true;
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
function observations() {
  return getExtensionStore('mmd:mutations', () => new Set<WeakRef<Observation>>());
}

export function recoverMutations(): void {
  const pending = observations();
  for (const reference of pending) {
    const observation = reference.deref();
    if (observation === undefined) pending.delete(reference);
    else observation.recover();
  }
}

export function resumeMutations(): void {
  for (const reference of observations()) {
    const observation = reference.deref();
    if (observation !== undefined) globalThis.queueMicrotask(() => observation.recover());
  }
}

export function captureMutationScope(): () => void {
  const pending = observations();
  const before = new Set(pending);
  return () => {
    for (const reference of pending) {
      const observation = reference.deref();
      if (observation === undefined) pending.delete(reference);
      else if (!before.has(reference)) observation.recover();
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
  let values: unknown[] = [];
  let reached: Set<object>[] = [];
  const objects = new Map<object, unknown[]>();
  function observe(): void {
    values = reads.map((read) => read());
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

  const pending = observations();
  let complete = false;
  const observation: Observation & { check(final: boolean): void } = {
    finish(result) {
      if (complete) return result;
      this.check(true);
      complete = true;
      pending.delete(reference);
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
      let moved = false;
      reads.forEach((read, index) => {
        const value = read();
        const replaced = !Object.is(value, values[index]);
        moved ||= replaced;
        if (replaced || reachesAny(reached[index]!, changed)) notify[index]!();
      });
      // A later recovery compares with what each read reaches now.
      if (!final && (moved || changed.size > 0)) observe();
      notifyAliases(changed, { kind: 'unknown' });
    },
  };
  const reference = new WeakRef(observation);
  pending.add(reference);
  // A call that throws cannot execute finish. Preserve completed edits at the
  // next boundary; authored catches perform the same recovery synchronously.
  globalThis.queueMicrotask(() => observation.recover());
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
      notify();
      notifyAliases(new Set([object]), edit);
    },
  };
}

export function deleteMutation(object: any, key: any, notify: () => void): boolean {
  const result = delete object[key];
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
      // Reading the old value could run a private or inherited getter.
      notifyAliases(new Set([object]), { kind: 'store', added: value, removed: true });
    },
  };
}
