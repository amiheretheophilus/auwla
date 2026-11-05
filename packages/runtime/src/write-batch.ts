/** Compiler-owned local write commits, independent of scheduler eagerness. */
import {
  enqueueEntityInvalidations, getActiveApplicationRuntime, getEntity, getExtensionStore,
  onEntityRender, runInApplicationRuntime, type Entity,
} from './kernel';
import { recoveryHooks } from './recovery-hooks';
import { advanceWriteEpoch } from './write-epoch';

const pendingBoundaries = new Set<LocalWriteBatch>();
const pendingRecoveries = new Set<LocalWriteBatch>();
let recoveryQueued = false;
// Shared state can dirty several application batches during one listener.
// Wait for the outermost listener across all batches before publishing them.
let listenerDepth = 0;

/** Preserve the operand while committing the synchronous stretch before await. */
export function flushWritesBeforeAwait<T>(value: T): T {
  recoveryHooks.recoverMutations();
  flushPendingWrites();
  return value;
}

/** A parent commit can send props that dirty a child in the same stretch. */
function flushPendingWrites(): void {
  while (pendingBoundaries.size > 0) {
    commitBatches(takeGroup(pendingBoundaries), true);
  }
}

/** Keep interleaved applications in first-mark order rather than regrouping them. */
function takeGroup(pending: Set<LocalWriteBatch>, first?: LocalWriteBatch): LocalWriteBatch[] {
  const group: LocalWriteBatch[] = first === undefined ? [] : [first];
  for (const batch of pending) {
    if (group.length > 0 && batch.runtime !== group[0]!.runtime) {
      break;
    }
    pending.delete(batch);
    group.push(batch);
  }
  return group;
}

function scheduleRecovery(): void {
  if (recoveryQueued) {
    return;
  }
  recoveryQueued = true;
  // This shared callback captures no row. Completed batches leave the set
  // immediately, even when the creating task has not yielded yet.
  globalThis.queueMicrotask(recoverWrites);
}

function recoverWrites(): void {
  recoveryQueued = false;
  while (pendingRecoveries.size > 0) {
    const first = pendingRecoveries.values().next().value!;
    pendingRecoveries.delete(first);
    first.resumeRecovery();
    // Consume only the first recovery before entering opaque observation. If
    // that phase throws, other rows must remain available to the continuation.
    if (pendingRecoveries.size > 0) {
      scheduleRecovery();
    }
    listenerDepth = 0;
    runInApplicationRuntime(first.runtime, recoveryHooks.recoverMutations);
    const group = takeGroup(pendingRecoveries, first);
    for (const batch of group) {
      batch.resumeRecovery();
    }
    commitBatches(group, true);
  }
}

function commitBatches(batches: readonly LocalWriteBatch[], force: boolean): void {
  const runtime = batches[0]!.runtime;
  runInApplicationRuntime(runtime, () => {
    const ids: string[] = [];
    for (const batch of batches) {
      const entity = batch.takeWrite(force);
      // Delayed work must not target a replacement that reused the same id.
      if (entity !== null && getEntity(entity.id) === entity) {
        ids.push(entity.id);
      }
    }
    // The kernel already orders parents before children and completes
    // independent renders after a failure. Publish the entire group together.
    enqueueEntityInvalidations(ids);
  });
}

function createBatchIndex(): WeakMap<Entity, LocalWriteBatch> {
  return new WeakMap();
}

function batchIndex(): WeakMap<Entity, LocalWriteBatch> {
  return getExtensionStore('mmd:write-batches', createBatchIndex);
}

onEntityRender((entity) => {
  // A parent may mark a child already included in the current kernel commit.
  // Consume that write when the child renders, not when the whole commit ends:
  // a later sibling may still write it again and need another update.
  batchIndex().get(entity)?.beginUpdate();
});

/** A call containing an awaited argument can still throw after resumption. */
export function resumeWritesAfterAwait<T>(value: T): T {
  recoveryHooks.resumeMutations();
  return value;
}

/** Authored writes remain illegal when compiler-owned const memos are refreshed. */
export function rejectConstAssignment(): never {
  throw new TypeError('Assignment to constant variable.');
}

/**
 * Whether an assignment left a binding holding the same primitive. Reassigning the
 * same object still reports: code the compiler cannot see may have edited it, and
 * `rows = rows` is how a program says so.
 */
export function unchangedWrite(before: unknown, after: unknown): boolean {
  return Object.is(before, after) && (before === null || (typeof before !== 'object' && typeof before !== 'function'));
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

/** State lives on the batch; helper methods are shared rather than per-row closures. */
class LocalWriteBatch implements WriteBatch {
  readonly runtime = getActiveApplicationRuntime();
  private active = false;
  private mounting = false;
  private dirty = false;
  private depth = 0;

  constructor(private readonly entity: Entity) {
    // Computations hold `mark` as their notifier. The other methods are always
    // called on the batch, and a component row should not pay for their closures.
    this.mark = this.mark.bind(this);
    batchIndex().set(entity, this);
  }

  beginMount(): void {
    this.mounting = true;
  }

  activate(): void {
    this.active = true;
    this.mounting = false;
    if (this.dirty) {
      pendingBoundaries.add(this);
      this.queueRecovery();
      if (listenerDepth === 0) {
        this.flush();
      }
    }
  }

  mark(): void {
    advanceWriteEpoch();
    if (!this.active) {
      // Setup seeds native values. Initial rendering remembers invalidations
      // without entering sites that have not finished mounting yet.
      if (this.mounting) {
        this.dirty = true;
      }
      return;
    }
    this.dirty = true;
    pendingBoundaries.add(this);
    this.queueRecovery();
  }

  flush(): void {
    commitBatches([this], false);
  }

  listener<T extends (...args: any[]) => any>(callback: T): T {
    const batch = this;
    return function (this: unknown, ...args: unknown[]) {
      batch.queueRecovery();
      batch.depth++;
      listenerDepth++;
      const result = Reflect.apply(callback, this, args);
      batch.depth--;
      listenerDepth--;
      if (listenerDepth === 0) {
        flushPendingWrites();
      }
      batch.releaseRecovery();
      return result;
    } as T;
  }

  beginUpdate(): void {
    this.dirty = false;
    pendingBoundaries.delete(this);
    this.releaseRecovery();
  }

  resumeRecovery(): void {
    this.depth = 0;
  }

  takeWrite(force: boolean): Entity | null {
    if (!this.active || !this.dirty || (!force && this.depth !== 0)) {
      this.releaseRecovery();
      return null;
    }
    this.beginUpdate();
    return this.entity;
  }

  private queueRecovery(): void {
    pendingRecoveries.add(this);
    scheduleRecovery();
  }

  private releaseRecovery(): void {
    if (this.depth === 0 && (!this.active || !this.dirty)) {
      pendingRecoveries.delete(this);
    }
  }
}

export function createWriteBatch(entity: Entity): WriteBatch {
  return new LocalWriteBatch(entity);
}
