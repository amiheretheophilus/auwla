import { AsyncLocalStorage } from 'node:async_hooks';
import { diagnostic, diagnosticHook, type DiagnosticEvent, type DiagnosticGlobal, type Domain } from './protocol';

const storage = new AsyncLocalStorage<(event: DiagnosticEvent) => void>();
/** Native dev host only. Concurrent Vite projects never share diagnostic sinks. */
export function runWithDiagnosticSink<T>(sink: ((event: DiagnosticEvent) => void) | undefined, callback: () => T): T {
  if (!sink) return callback();
  const realm = globalThis as DiagnosticGlobal;
  // This dispatcher keeps no project references; only active async scopes own sinks.
  realm[diagnosticHook] ??= { emit(domain: Domain, event: string, details: unknown) {
    try { const output = diagnostic(domain, event, details, 'server'); if (output) storage.getStore()?.(output); } catch { /* Never change a request. */ }
  } };
  return storage.run(sink, callback);
}
