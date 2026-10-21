/** Shared version notifications retain native module/factory values. */
import { publishVersions } from './computation';
import { registerSharedMutationRoots } from './mutation';

export function createSharedWrites(keys: readonly object[]) {
  const watched: { read: () => unknown; notify: () => void }[] = [];
  return {
    mark() { publishVersions(keys); },
    watch(roots: readonly { read: () => unknown; notify: () => void }[]) {
      watched.push(...roots);
      registerSharedMutationRoots(this, watched);
    },
  };
}
