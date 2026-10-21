/** Runtime invocation ownership for compiler-next setup and memo replay. */
import { getActiveApplicationRuntime, getExtensionStore, onCommitFinished } from './kernel';
import { captureComputationScope, resetComputationScope } from './computation';
import { captureMutationScope } from './mutation';

interface BuildStore {
  current: BuildFrame | null;
  epoch: number;
  queued: boolean;
}
const frameStores = new WeakMap<BuildFrame, BuildStore>();

export interface BuildFrame {
  readonly owner: object;
  readonly scope: object;
  readonly previous: BuildFrame | null;
  readonly epoch: number;
  readonly onAbandon?: () => void;
}

export interface BuildScope {
  enter(onAbandon?: () => void): BuildFrame;
  leave(frame: BuildFrame): void;
  building(): boolean;
  active(): boolean;
  finish<T>(frame: BuildFrame, value: T): T;
}

function buildStore(): BuildStore {
  return getExtensionStore('mmd:build-scope', () => ({ current: null, epoch: 0, queued: false }));
}

export function isBuilding(): boolean { return buildStore().current !== null; }

function reset(store: BuildStore): void {
  settleAbandoned(store, null);
  store.current = null;
  store.epoch++;
  resetComputationScope();
}

function settleAbandoned(store: BuildStore, stop: BuildFrame | null): void {
  for (let frame = store.current; frame !== null && frame !== stop; frame = frame.previous) frame.onAbandon?.();
}

onCommitFinished((failed) => {
  if (failed) reset(buildStore());
});

/** Restore the dynamic owner at an authored catch/finally boundary. */
export function captureBuildScope(): () => void {
  const store = buildStore();
  const current = store.current;
  const epoch = store.epoch;
  const restoreComputation = captureComputationScope();
  const restoreMutations = captureMutationScope();
  return () => {
    // An async continuation must not revive an owner from a finished turn.
    if (store.epoch === epoch) {
      settleAbandoned(store, current);
      store.current = current;
      restoreComputation();
      restoreMutations();
    }
  };
}

/** Each invocation has its own identity, even when an entity id is reused. */
export function createBuildScope(shared = false, inheritOwner = false): BuildScope {
  const runtime = getActiveApplicationRuntime();
  const store = buildStore();
  const owner = inheritOwner ? store.current?.owner ?? {} : {};
  const scope = {};
  return {
    enter(onAbandon) {
      const active = shared ? buildStore() : store;
      const frame: BuildFrame = { owner, scope, previous: active.current, epoch: active.epoch, onAbandon };
      frameStores.set(frame, active);
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
    },
    leave(frame) {
      const active = frameStores.get(frame)!;
      if (frame.epoch !== active.epoch) return;
      active.current = frame.previous;
    },
    building() {
      const active = shared ? buildStore() : store;
      return (shared || getActiveApplicationRuntime() === runtime) && active.current?.owner === owner;
    },
    active() {
      const active = shared ? buildStore() : store;
      if (!shared && getActiveApplicationRuntime() !== runtime) return false;
      for (let frame = active.current; frame !== null; frame = frame.previous) {
        if (frame.scope === scope && frame.epoch === active.epoch) return true;
      }
      return false;
    },
    finish(frame, value) {
      this.leave(frame);
      return value;
    },
  };
}
