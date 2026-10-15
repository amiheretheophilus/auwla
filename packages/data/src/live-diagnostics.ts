/** Internal development diagnostics; no payloads, retained history, or subscriptions. */
export function liveDiagnosticsEnabled(): boolean {
  return (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ??
    (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');
}

/** Function/endpoint name only; request URLs remain in the ordinary HTTP log. */
export function liveDiagnosticName(url: string): string {
  const name = new URL(url, 'http://memoized.invalid').pathname.split('/').filter(Boolean).at(-1) ?? '/';
  try { return decodeURIComponent(name); } catch { return name; }
}

/** Callers guard detail construction so production delivery does not allocate logs. */
export function reportLiveDiagnostic(
  event: string,
  details: Readonly<Record<string, unknown>>,
  level: 'debug' | 'warn' = 'debug',
): void {
  try { console[level](`[memoized-dom:live] ${event}`, details); }
  catch {
    // A console extension must not change request settlement or source cleanup.
  }
}
