/**
 * Module state a server render owns (`wiki/compiler/server.md`, "Request isolation").
 *
 * A browser evaluates every module once per user. A server evaluates it once for every user,
 * so state a page writes while rendering one request would be what the next request reads. In a
 * server build, compiler-next keeps such a module's state in a record: the module's own top-level
 * variables serve code that runs outside any render, and each server render gets a record of its
 * own, built by re-running the module's state setup the first time that render touches it.
 *
 * The record lives on the render's application runtime, which follows `await` on a server
 * (`application-scope.ts`), and goes away with it.
 */
import { outsideBuild } from './build-scope';
import { captureComputationScope, resetComputationScope } from './computation';
import { getActiveEnvironment, getExtensionStore } from './kernel';

type Records = Map<object, object>;

/**
 * The module state the running code should use: this server render's record, or `process` (the
 * module's own variables) outside any server render. `initialize` fills a new record; it is also
 * the module's identity, one function per module.
 */
export function requestModuleState<T extends object>(process: T, initialize: (record: T) => void): T {
  if (!getActiveEnvironment().mode.startsWith('server-')) {
    return process;
  }

  const records = getExtensionStore<Records>('mmd:module-state', () => new Map());
  const existing = records.get(initialize);
  if (existing !== undefined) {
    return existing as T;
  }

  // Registered before it is filled: the setup calls the module's own functions, which ask for
  // this record again and must get the one being built, not start another.
  const record = {} as T;
  records.set(initialize, record);
  let built = false;
  try {
    runAsModuleSetup(() => initialize(record));
    built = true;
  } finally {
    // A setup that threw leaves no half-built record behind; the next use tries again, as a
    // module that failed to evaluate would be tried again on its next import.
    if (!built) {
      records.delete(initialize);
    }
  }
  return record;
}

/** As at module evaluation: no component's frame, and no computation recording reads. */
function runAsModuleSetup(run: () => void): void {
  const restoreComputation = captureComputationScope();
  resetComputationScope();
  try {
    outsideBuild(run);
  } finally {
    restoreComputation();
  }
}
