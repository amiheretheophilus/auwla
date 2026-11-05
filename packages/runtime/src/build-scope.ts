/** Runtime invocation ownership for compiler-next setup and memo replay. */
import {
  getActiveApplicationRuntime,
  getExtensionStore,
  onCommitFinished,
  runInApplicationRuntime,
  type ApplicationRuntime,
} from './kernel';
import { recoveryHooks } from './recovery-hooks';

interface BuildStore {
  readonly runtime: ApplicationRuntime;
  current: BuildFrame | null;
  epoch: number;
  queued: boolean;
}

export interface BuildFrame {
  readonly owner: object;
  readonly scope: object;
  readonly previous: BuildFrame | null;
  readonly epoch: number;
  readonly invocation: boolean;
  readonly onAbandon?: () => void;
  readonly store: BuildStore;
}

export interface BuildScope {
  enter(onAbandon?: () => void): BuildFrame;
  leave(frame: BuildFrame): void;
  building(): boolean;
  active(): boolean;
  finish<T>(frame: BuildFrame, value: T): T;
}

function buildStore(): BuildStore {
  return getExtensionStore('mmd:build-scope', () => ({
    runtime: getActiveApplicationRuntime(),
    current: null,
    epoch: 0,
    queued: false,
  }));
}

export function isBuilding(): boolean {
  return buildStore().current !== null;
}

/** Feature-owned context follows the same frames and exception recovery as setup. */
export function currentBuildFrame(): BuildFrame | null {
  return buildStore().current;
}

/** Effect-owned locals are native invocation values, not independent memos. */
export function isEffectInvocation(): boolean {
  return buildStore().current?.invocation ?? false;
}

function reset(store: BuildStore): void {
  // A queued reset may run while another application is active. Both teardown
  // and collector recovery still belong to the application that owns the frames.
  runInApplicationRuntime(store.runtime, () => {
    settleAbandoned(store, null);
    store.current = null;
    store.epoch++;
    recoveryHooks.resetComputations();
  });
}

function settleAbandoned(store: BuildStore, stop: BuildFrame | null): void {
  for (let frame = store.current; frame !== null && frame !== stop; frame = frame.previous) {
    frame.onAbandon?.();
  }
}

onCommitFinished((failed) => {
  if (failed) {
    reset(buildStore());
  }
});

/** Restore the dynamic owner at an authored catch/finally boundary. */
export function captureBuildScope(): () => void {
  const store = buildStore();
  const current = store.current;
  const epoch = store.epoch;
  const restoreComputation = recoveryHooks.captureComputations();
  const restoreMutations = recoveryHooks.captureMutations();
  return () => {
    // Recovery belongs to the captured application even if another one is
    // currently active. Mutation notifications can consult that active context.
    runInApplicationRuntime(store.runtime, () => {
      // An async continuation must not revive an owner from a finished turn.
      if (store.epoch === epoch) {
        settleAbandoned(store, current);
        store.current = current;
        restoreComputation();
        restoreMutations();
      }
    });
  };
}

/** A class, not closures: a component row creates one per instance. */
class Scope implements BuildScope {
  private readonly runtime = getActiveApplicationRuntime();
  private readonly store = buildStore();
  // A lexical block shares its surrounding setup's write ownership, but needs
  // a distinct scope identity to tell whether that particular block is active.
  private readonly owner: object;

  constructor(private readonly shared: boolean, inheritOwner: boolean, private readonly invocation: boolean) {
    this.owner = inheritOwner ? this.store.current?.owner ?? {} : {};
  }

  private activeStore(): BuildStore {
    return this.shared ? buildStore() : this.store;
  }

  enter(onAbandon?: () => void): BuildFrame {
    const active = this.activeStore();
    const frame: BuildFrame = {
      owner: this.owner, scope: this, previous: active.current, epoch: active.epoch, onAbandon, store: active,
      invocation: this.invocation || (active.current?.invocation ?? false),
    };
    active.current = frame;
    if (!active.queued) {
      active.queued = true;
      // A throwing setup cannot execute its leave. Discard abandoned frames
      // at the next synchronous boundary without wrapping authored code.
      globalThis.queueMicrotask(() => {
        active.queued = false;
        reset(active);
      });
    }
    return frame;
  }

  leave(frame: BuildFrame): void {
    const active = frame.store;
    if (frame.epoch !== active.epoch) {
      return;
    }
    active.current = frame.previous;
  }

  building(): boolean {
    return (this.shared || getActiveApplicationRuntime() === this.runtime) && this.activeStore().current?.owner === this.owner;
  }

  active(): boolean {
    if (!this.shared && getActiveApplicationRuntime() !== this.runtime) {
      return false;
    }
    const active = this.activeStore();
    for (let frame = active.current; frame !== null; frame = frame.previous) {
      if (frame.scope === this && frame.epoch === active.epoch) {
        return true;
      }
    }
    return false;
  }

  finish<T>(frame: BuildFrame, value: T): T {
    this.leave(frame);
    return value;
  }
}

/** Each invocation has its own identity, even when an entity id is reused. */
export function createBuildScope(shared = false, inheritOwner = false, invocation = false): BuildScope {
  return new Scope(shared, inheritOwner, invocation);
}
