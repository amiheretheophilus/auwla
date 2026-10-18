/** Internal, versioned metadata protocol. Never pass application values through it. */
export const diagnosticHook = Symbol.for('memoized-dom:diagnostics:v1');
export const diagnosticProviders = Symbol.for('memoized-dom:diagnostic-providers:v1');
export const inspectorEvent = 'memoized-dom:inspector:event';
export const inspectorOpen = 'memoized-dom:inspector:open';
export const inspectorClose = 'memoized-dom:inspector:close';
export const inspectorReady = 'memoized-dom:inspector:ready';
export type Domain = 'live' | 'trace';
export type Origin = 'browser' | 'server';
export type Stamp = { key: string; epoch: string; revision: number };
export interface AuthoredLocation { file: string; component: string; sectionLine: number; code: string; line: number; column: number; highlightStart: number; highlightEnd: number }
export type Metadata = Record<string, string | number | boolean | readonly string[] | readonly Stamp[] | Stamp | AuthoredLocation>;
export interface DiagnosticEvent { version: 1; domain: Domain; event: string; origin: Origin; timestamp: number; data: Metadata }
export interface DiagnosticHook { trace?: boolean; emit(domain: Domain, event: string, details: unknown): void }
export type DiagnosticGlobal = typeof globalThis & { [diagnosticHook]?: DiagnosticHook; [diagnosticProviders]?: Set<() => void> };
const allowedEvents = new Set([
  'subscribe', 'unsubscribe', 'invalidate', 'query-started', 'query-delivered', 'query-discarded',
  'snapshot-received', 'snapshot-rejected', 'snapshot-held', 'snapshot-applied', 'source-current', 'source-disposed',
  'protection-started', 'protection-released', 'confirmation-ignored', 'confirmation-epoch-changed',
  'missing-mutation-confirmation', 'optimistic-callback-failed',
  'connection-state', 'subscription-opened', 'subscription-closed', 'subscription-fallback', 'subscription-error',
  'frame-received', 'patch-received', 'baseline-recovery', 'event-started', 'event-returned', 'event-threw',
  'write-published', 'update-started', 'update-completed', 'update-threw', 'binding-evaluated', 'dom-write', 'trace-throttled',
  'event-registered', 'region-registered', 'trace-site-disposed',
]);
const stringFields = ['source', 'method', 'sourceId', 'connectionId', 'subscriptionId', 'transport', 'stream', 'state',
  'key', 'epoch', 'reason', 'component', 'type', 'binding', 'operation', 'queryKey', 'mutationKey', 'scope', 'trigger', 'kind', 'siteId'];
const numberFields = ['revision', 'sequence', 'base', 'pending', 'attempt', 'subscribers', 'eventId', 'limit', 'windowMs', 'evaluationLimit', 'messages', 'evaluations'];
function own(input: object, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(input, key);
  return property && 'value' in property ? property.value : undefined;
}
function items(input: unknown): unknown[] | undefined {
  if (!Array.isArray(input)) return;
  const length = own(input, 'length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return;
  return Array.from({ length: Math.min(length, 16) }, (_, index) => own(input, String(index)));
}
function stamp(input: unknown): Stamp | undefined {
  if (!input || typeof input !== 'object') return;
  const key = own(input, 'key'), epoch = own(input, 'epoch'), revision = own(input, 'revision');
  if (typeof key === 'string' && typeof epoch === 'string' && typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0) {
    return { key: key.slice(0, 512), epoch: epoch.slice(0, 128), revision };
  }
}
function location(input: unknown): AuthoredLocation | undefined {
  if (!input || typeof input !== 'object') return;
  const file = own(input, 'file'), component = own(input, 'component'), code = own(input, 'code');
  const numbers = ['sectionLine', 'line', 'column', 'highlightStart', 'highlightEnd'].map(key => own(input, key));
  if (typeof file !== 'string' || typeof component !== 'string' || typeof code !== 'string' || code.length > 24_512 ||
    numbers.some(value => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) return;
  const [sectionLine, line, column, highlightStart, highlightEnd] = numbers as number[];
  if (!sectionLine || !line || !column || highlightStart! >= highlightEnd! || highlightEnd! > code.length) return;
  return { file: file.slice(0, 512), component: component.slice(0, 256), code, sectionLine, line, column, highlightStart: highlightStart!, highlightEnd: highlightEnd! };
}
/** Whitelist/copy primitives only. No getters, URLs, errors, DOM nodes or arbitrary objects. */
export function diagnostic(domain: unknown, event: unknown, details: unknown, origin: Origin, timestamp = Date.now()): DiagnosticEvent | undefined {
  try {
    if ((domain !== 'live' && domain !== 'trace') || typeof event !== 'string' || !allowedEvents.has(event) ||
      !details || typeof details !== 'object' || !Number.isFinite(timestamp)) return;
    const data: Metadata = {};
    for (const field of stringFields) {
      const value = own(details, field);
      if (typeof value === 'string') data[field] = value.slice(0, field === 'key' ? 512 : 256);
    }
    for (const field of numberFields) {
      const value = own(details, field);
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) data[field] = value;
    }
    const fallback = own(details, 'fallback'); if (typeof fallback === 'boolean') data.fallback = fallback;
    for (const field of ['stamp', 'current', 'required']) { const value = stamp(own(details, field)); if (value) data[field] = value; }
    for (const field of ['sources', 'keys']) {
      const value = items(own(details, field));
      if (value) data[field] = value.filter((item): item is string => typeof item === 'string').map(item => item.slice(0, 256));
    }
    const confirmations = items(own(details, 'confirmations'));
    if (confirmations) data.confirmations = confirmations.flatMap(item => { const value = stamp(item); return value ? [value] : []; });
    // Authored client JSX is opt-in development code context, not a server relay payload.
    if (origin === 'browser' && domain === 'trace') { const value = location(own(details, 'location')); if (value) data.location = value; }
    return { version: 1, domain, event, origin, timestamp, data };
  } catch { return; }
}
export function readDiagnostic(input: unknown): DiagnosticEvent | undefined {
  try {
    if (!input || typeof input !== 'object' || own(input, 'version') !== 1) return;
    const origin = own(input, 'origin'), timestamp = own(input, 'timestamp');
    if ((origin !== 'browser' && origin !== 'server') || typeof timestamp !== 'number') return;
    return diagnostic(own(input, 'domain'), own(input, 'event'), own(input, 'data'), origin, timestamp);
  } catch { return; }
}
