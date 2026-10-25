/** Shared version notifications retain native module/factory values. */
import { publishVersions } from './computation';
import { checkSharedMutationRoots, registerSharedMutationRoots } from './mutation';
import { writeEpoch } from './write-epoch';

/**
 * `keys` are the owner's bindings. A write notifies the readers of the binding
 * written and of every `recomputed` binding (a derived value refreshes when it
 * is read, so its readers cannot be told which input changed). Readers of
 * other state are not woken: a list row reading `selected` is untouched by a
 * write to `data`.
 */
export function createSharedWrites(keys: readonly object[], recomputed: readonly object[] = keys) {
  const watched: { read: () => unknown; notify: () => void }[] = [];
  let refreshed = -1;
  return {
    /**
     * Whether a write happened since the owner's last refresh began. Only a
     * write can make its derivations or watched roots differ, so the readers
     * of one render refresh once, not once per read. A refresh that writes
     * leaves the owner stale, and the next read refreshes again.
     */
    stale(): boolean {
      return refreshed !== writeEpoch();
    },
    refreshing(): void {
      refreshed = writeEpoch();
    },
    mark(written?: object) {
      checkSharedMutationRoots(watched);
      publishVersions(written === undefined ? keys : [written, ...recomputed], written);
    },
    /** Lazy derivations can replace their value after the input write published. */
    check() {
      checkSharedMutationRoots(watched);
    },
    watch(roots: readonly { read: () => unknown; notify: () => void }[]) {
      watched.push(...roots);
      registerSharedMutationRoots(this, watched);
    },
  };
}
