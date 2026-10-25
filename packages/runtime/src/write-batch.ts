/** Compiler-owned local write commits, independent of scheduler eagerness. */
import {
  getActiveApplicationRuntime, getEntity, invalidateEntity, runWithApplicationRuntime,
  type Entity,
} from './kernel';
import { recoverMutations, resumeMutations } from './mutation';

const pendingBoundaries = new Set<() => void>();
// Shared state can dirty several application batches during one listener.
// Wait for the outermost listener across all batches before publishing them.
let listenerDepth = 0;

/** Preserve the operand while committing the synchronous stretch before await. */
export function flushWritesBeforeAwait<T>(value: T): T {
  recoverMutations();
  flushPendingWrites();
  return value;
}

/** A parent commit can send props that dirty a child in the same stretch. */
function flushPendingWrites(): void {
  while (pendingBoundaries.size > 0) {
    const pending = [...pendingBoundaries];
    for (const flush of pending) {
      flush();
    }
  }
}

/** A call containing an awaited argument can still throw after resumption. */
export function resumeWritesAfterAwait<T>(value: T): T {
  resumeMutations();
  return value;
}

/** Authored writes remain illegal when compiler-owned const memos are refreshed. */
export function rejectConstAssignment(): never {
  throw new TypeError('Assignment to constant variable.');
}

export interface WriteBatch {
  /** Remember writes during initial rendering without entering unfinished sites. */
  beginMount(): void;
  /** Activate completed sites and settle invalidations from initial rendering. */
  activate(): void;
  mark(): void;
  flush(): void;
  /** Native listeners flush on return and preserve this, arguments and results. */
  listener<T extends (...args: any[]) => any>(callback: T): T;
}

export function createWriteBatch(entity: Entity): WriteBatch {
  const runtime = getActiveApplicationRuntime();
  let active = false;
  let mounting = false;
  let dirty = false;
  let queued = false;
  let depth = 0;

  const flush = (force = false) => {
    if (!active || !dirty || (!force && depth !== 0)) {
      return;
    }
    dirty = false;
    pendingBoundaries.delete(boundary);
    runWithApplicationRuntime(runtime, () => {
      // A delayed callback must not notify a new instance with the same id.
      if (getEntity(entity.id) === entity) {
        invalidateEntity(entity.id);
      }
    });
  };
  const boundary = () => flush(true);

  const queue = () => {
    if (queued) {
      return;
    }
    queued = true;
    globalThis.queueMicrotask(() => {
      queued = false;
      // Recover after any throwing listener, even if it threw before its first
      // write. No authored code needs an exception wrapper.
      depth = 0;
      listenerDepth = 0;
      runWithApplicationRuntime(runtime, recoverMutations);
      flush();
    });
  };

  return {
    beginMount() {
      mounting = true;
    },
    activate() {
      active = true;
      mounting = false;
      if (dirty) {
        pendingBoundaries.add(boundary);
        queue();
        if (listenerDepth === 0) {
          flush();
        }
      }
    },
    mark() {
      if (!active) {
        // Setup writes seed native values. Once rendering begins, later sites
        // and child setup may invalidate earlier reads; remember those changes
        // until every site and cleanup has been initialized.
        if (mounting) {
          dirty = true;
        }
        return;
      }
      dirty = true;
      pendingBoundaries.add(boundary);
      queue();
    },
    flush,
    listener(callback) {
      return function (this: unknown, ...args: unknown[]) {
        queue();
        depth++;
        listenerDepth++;
        const result = Reflect.apply(callback, this, args);
        depth--;
        listenerDepth--;
        if (listenerDepth === 0) {
          flushPendingWrites();
        }
        return result;
      } as typeof callback;
    },
  };
}
