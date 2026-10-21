/** Compiler-owned local write commits, independent of scheduler eagerness. */
import {
  getActiveApplicationRuntime, getEntity, invalidateEntity, runWithApplicationRuntime,
  type Entity,
} from './kernel';

export interface WriteBatch {
  /** Creation-time writes seed values; activation starts later notifications. */
  activate(): void;
  mark(): void;
  flush(): void;
  /** Native listeners flush on return and preserve this, arguments and results. */
  listener<T extends (...args: any[]) => any>(callback: T): T;
}

export function createWriteBatch(entity: Entity): WriteBatch {
  const runtime = getActiveApplicationRuntime();
  let active = false;
  let dirty = false;
  let queued = false;
  let depth = 0;

  const flush = () => {
    if (!active || !dirty || depth !== 0) return;
    dirty = false;
    runWithApplicationRuntime(runtime, () => {
      // A delayed callback must not notify a new instance with the same id.
      if (getEntity(entity.id) === entity) invalidateEntity(entity.id);
    });
  };

  const queue = () => {
    if (queued) return;
    queued = true;
    globalThis.queueMicrotask(() => {
      queued = false;
      // Recover after any throwing listener, even if it threw before its first
      // write. No authored code needs an exception wrapper.
      depth = 0;
      flush();
    });
  };

  return {
    activate() {
      active = true;
    },
    mark() {
      if (!active) return;
      dirty = true;
      queue();
    },
    flush,
    listener(callback) {
      return function (this: unknown, ...args: unknown[]) {
        queue();
        depth++;
        const result = Reflect.apply(callback, this, args);
        depth--;
        flush();
        return result;
      } as typeof callback;
    },
  };
}
