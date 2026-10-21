/** Runtime invocation ownership for compiler-next setup and memo replay. */
import { getActiveApplicationRuntime, getExtensionStore, onCommitFinished } from './kernel';

interface BuildStore {
  current: BuildFrame | null;
  epoch: number;
  queued: boolean;
}

export interface BuildFrame {
  readonly owner: object;
  readonly previous: BuildFrame | null;
  readonly epoch: number;
}

export interface BuildScope {
  enter(): BuildFrame;
  leave(frame: BuildFrame): void;
  building(): boolean;
}

function buildStore(): BuildStore {
  return getExtensionStore('mmd:build-scope', () => ({ current: null, epoch: 0, queued: false }));
}

function reset(store: BuildStore): void {
  store.current = null;
  store.epoch++;
}

onCommitFinished((failed) => {
  if (failed) reset(buildStore());
});

/** Each invocation has its own identity, even when an entity id is reused. */
export function createBuildScope(): BuildScope {
  const runtime = getActiveApplicationRuntime();
  const store = buildStore();
  const owner = {};
  return {
    enter() {
      const frame: BuildFrame = { owner, previous: store.current, epoch: store.epoch };
      store.current = frame;
      if (!store.queued) {
        store.queued = true;
        // A throwing setup cannot execute its leave. Discard abandoned frames
        // at the next synchronous boundary without wrapping authored code.
        globalThis.queueMicrotask(() => {
          store.queued = false;
          reset(store);
        });
      }
      return frame;
    },
    leave(frame) {
      if (frame.epoch !== store.epoch) return;
      store.current = frame.previous;
    },
    building() {
      return getActiveApplicationRuntime() === runtime && store.current?.owner === owner;
    },
  };
}
