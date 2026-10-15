import { isFetchResource, resourceController, fetchResourceUpdates } from './resource';
import { isModuleSourceRef, resolveModuleSource } from './transparent-module';
import { liveDiagnosticsEnabled, reportLiveDiagnostic } from './live-diagnostics';

/** Returns an idempotent release; source identity is the shared entry at call start. */
export function protectLiveSources(input: unknown): (result?: unknown) => void {
  if (input === undefined) return () => {};
  const values = Array.isArray(input) ? input : [input];
  const entries = new Set<NonNullable<ReturnType<typeof resourceController>['entry']>>();
  for (const value of values) {
    const holder = isModuleSourceRef(value) ? resolveModuleSource(value) : value;
    if (!isFetchResource(holder)) throw new TypeError('optimistic source must reference a live source, not its payload');
    const entry = resourceController(holder).entry;
    if (entry === null || entry.descriptor.stream !== 'live') throw new TypeError('optimistic source must be a live query');
    entries.add(entry);
  }
  const releases = [...entries].map(entry => entry.protection.protect());
  let released = false;
  return result => {
    if (released) return;
    released = true;
    const updates = fetchResourceUpdates(result);
    if (result !== undefined && entries.size > 0 && updates.length === 0 && liveDiagnosticsEnabled()) {
      reportLiveDiagnostic('missing-mutation-confirmation', {
        reason: 'pending-only-protection',
        keys: [...entries].map(entry => entry.protection.stamp?.key ?? null),
        message: 'This successful optimistic operation supplied no mutation confirmation. Pending protection still works, but older snapshots cannot be rejected using this result. Return the server-function result directly when relying on its acknowledgements; ordinary promises remain supported.',
      }, 'warn');
    }
    for (const release of releases) release(updates);
  };
}
