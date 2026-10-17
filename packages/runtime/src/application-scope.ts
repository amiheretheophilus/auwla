/** Host context propagation is optional for ordinary browser updates. */
import { createStorage, type StorageShim } from './async-storage';
import {
  installApplicationRuntimeScope,
  runInApplicationRuntime,
  type ApplicationRuntime,
} from './kernel';

let storage: StorageShim<ApplicationRuntime> | undefined;

/** @internal Connect this kernel copy to the shared request scope. */
export function installApplicationRuntimeStorage(): void {
  if (!storage) {
    storage = createStorage<ApplicationRuntime>('runtime');
    installApplicationRuntimeScope(storage);
  }
}

/** Install lazily so a later server entry can select AsyncLocalStorage. */
export function runWithApplicationRuntime<T>(runtime: ApplicationRuntime, run: () => T): T {
  installApplicationRuntimeStorage();
  return runInApplicationRuntime(runtime, run);
}
