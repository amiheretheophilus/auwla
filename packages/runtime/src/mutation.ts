/** Native member targets and observation for opaque calls. */
import { getExtensionStore, onEntityDispose, type Entity } from './kernel';

interface Root { readonly read: () => unknown; readonly notify: () => void }
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

function notifyAliases(changed: ReadonlySet<object>): void {
  if (changed.size === 0) return;
  const callbacks = new Set<() => void>();
  for (const entry of roots().values()) {
    for (const root of entry.roots) reachable(root.read(), (object) => {
      if (changed.has(object)) callbacks.add(root.notify);
    });
  }
  for (const notify of callbacks) notify();
}

/** Data descriptors avoid running getters merely to check for a mutation. */
function snapshot(value: unknown, shallow = false): unknown[] {
  const result: unknown[] = [];
  const seen = new Map<object, number>();
  const visit = (entry: any, root = false): void => {
    if (entry === null || (typeof entry !== 'object' && typeof entry !== 'function')) {
      result.push(entry);
      return;
    }
    if (shallow && !root) { result.push(entry); return; }
    const prior = seen.get(entry);
    if (prior !== undefined) { result.push('reference', prior); return; }
    seen.set(entry, seen.size);
    result.push(entry, Object.getPrototypeOf(entry));
    if (entry instanceof Map) {
      result.push('map', entry.size);
      Map.prototype.forEach.call(entry, (value: unknown, key: unknown) => { visit(key); visit(value); });
    } else if (entry instanceof Set) {
      result.push('set', entry.size);
      Set.prototype.forEach.call(entry, (item: unknown) => visit(item));
    } else if (entry instanceof Date) {
      result.push(Date.prototype.getTime.call(entry));
    } else if (ArrayBuffer.isView(entry)) {
      const bytes = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
      result.push(bytes.length, ...bytes);
    } else if (entry instanceof ArrayBuffer) {
      result.push(entry.byteLength, ...new Uint8Array(entry));
    }
    const keys = Reflect.ownKeys(entry);
    result.push(keys.length);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key)!;
      result.push(key, descriptor.enumerable, descriptor.configurable);
      if ('value' in descriptor) {
        result.push(descriptor.writable);
        visit(descriptor.value);
      } else result.push(descriptor.get, descriptor.set);
    }
  };
  visit(value, true);
  return result;
}

interface Observation { finish<T>(result: T): T }
function observations() {
  return getExtensionStore('mmd:mutations', () => new Set<Observation>());
}

export function captureMutationScope(): () => void {
  const pending = observations();
  const before = new Set(pending);
  return () => { for (const observation of pending) if (!before.has(observation)) observation.finish(undefined); };
}

export function observeMutation(reads: readonly (() => unknown)[], notify: readonly (() => void)[]): Observation {
  const before = reads.map((read) => snapshot(read()));
  const objects = new Map<object, unknown[]>();
  for (const read of reads) reachable(read(), (object) => {
    if (!objects.has(object)) objects.set(object, snapshot(object, true));
  });
  const pending = observations();
  const observation: Observation = {
    finish(result) {
      if (!pending.delete(observation)) return result;
      reads.forEach((read, index) => {
        const after = snapshot(read());
        const prior = before[index]!;
        if (prior.length !== after.length || prior.some((value, i) => !Object.is(value, after[i]))) notify[index]!();
      });
      const changed = new Set<object>();
      for (const [object, prior] of objects) {
        const after = snapshot(object, true);
        if (prior.length !== after.length || prior.some((value, i) => !Object.is(value, after[i]))) changed.add(object);
      }
      notifyAliases(changed);
      return result;
    },
  };
  pending.add(observation);
  // A call that throws cannot execute finish. Preserve completed edits at the
  // next boundary; authored catches perform the same recovery synchronously.
  globalThis.queueMicrotask(() => observation.finish(undefined));
  return observation;
}

export function mutationTarget(object: any, key: any, notify: () => void) {
  // Computed property names perform ToPropertyKey before evaluating the RHS.
  const property = Reflect.ownKeys({ [key]: 0 })[0]!;
  return {
    get value() { return object[property]; },
    set value(value: unknown) {
      object[property] = value;
      notify();
      notifyAliases(new Set([object]));
    },
  };
}

export function deleteMutation(object: any, key: any, notify: () => void): boolean {
  const result = delete object[key];
  notify();
  notifyAliases(new Set([object]));
  return result;
}
