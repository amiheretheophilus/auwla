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
type WaitingSetup = (record: object) => Promise<void>;

/**
 * Setups that wait (`let n = await load()` at a module's top level), by module path. A render
 * cannot stop in the middle of a component to wait, so it builds these records before it mounts
 * anything (`prepareRequestModuleStates`). By path, so a module evaluated again (a dev server's
 * update) replaces its entry. In evaluation order, which puts a module's dependencies first.
 * On the realm, as the async storage registry is (`async-storage.ts`): the server package and
 * compiled code may reach the runtime through different entries.
 */
interface WaitingRegistry {
  readonly setups: Map<string, WaitingSetup>;
  readonly initializers: WeakSet<object>;
}

const WAITING_KEY = Symbol.for('memoized-dom:waiting-module-state');

function waitingRegistry(): WaitingRegistry {
  const realm = globalThis as unknown as Record<symbol, WaitingRegistry | undefined>;
  return realm[WAITING_KEY] ??= { setups: new Map(), initializers: new WeakSet() };
}

/** Called by a module whose state setup waits, when it loads (`request-dom.ts` in compiler-next). */
export function registerWaitingModuleState(module: string, initialize: WaitingSetup): void {
  const { setups, initializers } = waitingRegistry();
  // Deleted first, so a module evaluated again takes its place in evaluation order.
  setups.delete(module);
  setups.set(module, initialize);
  initializers.add(initialize);
}

/**
 * Builds this server render's records of every module whose setup waits, one after another as
 * the modules evaluated. `packages/server` awaits it before a render mounts, with the render's
 * runtimes active, which follow `await` on a server. Nothing runs outside a server render.
 */
export async function prepareRequestModuleStates(): Promise<void> {
  if (!getActiveEnvironment().mode.startsWith('server-')) {
    return;
  }

  const records = getExtensionStore<Records>('mmd:module-state', () => new Map());
  for (const initialize of [...waitingRegistry().setups.values()]) {
    if (records.has(initialize)) continue;

    // Registered first, as below: what the setup calls asks for this record.
    const record = {};
    records.set(initialize, record);
    let built = false;
    try {
      await initialize(record);
      built = true;
    } finally {
      if (!built) {
        records.delete(initialize);
      }
    }
  }
}

/**
 * The module state the running code should use: this server render's record, or `process` (the
 * module's own variables) outside any server render. `initialize` fills a new record; it is also
 * the module's identity, one function per module.
 */
export function requestModuleState<T extends object>(process: T, initialize: (record: T) => unknown): T {
  if (!getActiveEnvironment().mode.startsWith('server-')) {
    return process;
  }

  const records = getExtensionStore<Records>('mmd:module-state', () => new Map());
  const existing = records.get(initialize);
  if (existing !== undefined) {
    return existing as T;
  }
  if (waitingRegistry().initializers.has(initialize)) {
    // Silently using the process's copy would hand one user's writes to the next.
    throw new Error(
      'memo-dom: this module\'s state waits (`await` in its setup), so a server render builds it '
        + 'before it starts; this render did not. Render with render() or a stream, not renderToString().',
    );
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
