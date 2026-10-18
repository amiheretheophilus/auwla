/** Internal development diagnostics; no payloads, retained history, or subscriptions. */
export function liveDiagnosticsEnabled(): boolean {
  return (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env !== undefined && typeof (import.meta as ImportMeta & { env: { DEV?: boolean } }).env.DEV === 'boolean'
    ? (import.meta as ImportMeta & { env: { DEV?: boolean } }).env.DEV === true
    : (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');
}

/** Function/endpoint name only; request URLs remain in the ordinary HTTP log. */
export function liveDiagnosticName(url: string): string {
  try {
    const name = new URL(url, 'http://memoized.invalid').pathname.split('/').filter(Boolean).at(-1) ?? '/';
    try { return decodeURIComponent(name); } catch { return name; }
  } catch { return 'unknown'; }
}

/** Callers guard detail construction so production delivery does not allocate logs. */
export function reportLiveDiagnostic(
  event: string,
  details: Readonly<Record<string, unknown>>,
  level: 'debug' | 'warn' = 'debug',
): void {
  if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env !== undefined && (import.meta as ImportMeta & { env: { DEV?: boolean } }).env.DEV === false) return;
  if (!liveDiagnosticsEnabled()) return;
  try {
    const sink = (globalThis as typeof globalThis & { [key: symbol]: { emit?: (domain: string, event: string, details: unknown) => void } | undefined })[Symbol.for('memoized-dom:diagnostics:v1')];
    sink?.emit?.('live', event, details);
  } catch { /* Optional tooling must never change delivery. */ }
  try { console[level](`[memoized-dom:live] ${event}`, details); }
  catch {
    // A console extension must not change request settlement or source cleanup.
  }
}

/** Stable, opaque metadata identities, shared across duplicate development modules. */
export function liveDiagnosticId(kind: string): string | undefined {
  if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env !== undefined && (import.meta as ImportMeta & { env: { DEV?: boolean } }).env.DEV === false) return;
  if (!liveDiagnosticsEnabled()) return;
  try {
    const realm = globalThis as typeof globalThis & { [key: symbol]: number | undefined };
    const key = Symbol.for('memoized-dom:diagnostic-counter:v1');
    return kind + '-' + (realm[key] = (realm[key] ?? 0) + 1);
  } catch { return; }
}

/** Active facts only, no event history or payload copies. Dispose with the owning source. */
export function observeLiveDiagnostic(replay: () => void): () => void {
  if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env !== undefined && (import.meta as ImportMeta & { env: { DEV?: boolean } }).env.DEV === false) return () => {};
  if (!liveDiagnosticsEnabled() || typeof window === 'undefined') return () => {};
  try {
    const realm = globalThis as typeof globalThis & { [key: symbol]: Set<() => void> | undefined };
    const key = Symbol.for('memoized-dom:diagnostic-providers:v1');
    const providers = realm[key] ??= new Set();
    if (providers.size >= 512) return () => {};
    providers.add(replay);
    return () => { try { providers.delete(replay); if (!providers.size && realm[key] === providers) delete realm[key]; } catch { /* Ignore tooling tampering. */ } };
  } catch { return () => {}; }
}
