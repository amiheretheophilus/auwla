import { diagnostic, diagnosticHook, diagnosticProviders, readDiagnostic, type DiagnosticEvent, type DiagnosticGlobal, type Metadata, type Stamp } from './protocol';

export interface Subscription {
  id: string; source: string; method: string; connectionId?: string; transport?: string; key?: string; epoch?: string;
  revision?: number; sequence?: number; pending: number; state: string; reason?: string; attempt: number;
}
export interface Connection { id: string; transport: string; state: string; attempt: number }
export interface Issue { id: number; event: DiagnosticEvent; summary: string; count: number }
export interface TraceSite { id: string; registration: DiagnosticEvent; last?: DiagnosticEvent; runs: number; activatedAt?: number }
export class InspectorStore {
  readonly traceSites = new Map<string, TraceSite>();
  readonly subscriptions = new Map<string, Subscription>();
  readonly connections = new Map<string, Connection>();
  readonly issues: Issue[] = [];
  private readonly ring: (DiagnosticEvent | undefined)[];
  private cursor = 0;
  private size = 0;
  private listeners = new Set<() => void>();
  private queued = false;
  private stopped = false;
  private nextIssueId = 0;
  dropped = 0;
  constructor(readonly capacity = 800) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4000) throw new Error('Inspector capacity must be 1..4000');
    this.ring = Array.from({ length: capacity });
  }
  get events(): DiagnosticEvent[] {
    return Array.from({ length: this.size }, (_, index) => this.ring[(this.cursor - this.size + index + this.capacity) % this.capacity]!);
  }
  accept(input: unknown): void {
    if (this.stopped) return;
    const event = readDiagnostic(input); if (!event) return;
    if (event.domain === 'trace' && typeof event.data.siteId === 'string') {
      const id = event.data.siteId;
      if (event.event === 'trace-site-disposed') this.traceSites.delete(id);
      else if (event.event.endsWith('-registered')) {
        if (!this.traceSites.has(id)) this.traceSites.set(id, { id, registration: event, runs: 0 });
        while (this.traceSites.size > 512) this.traceSites.delete(this.traceSites.keys().next().value!);
      } else {
        const site = this.traceSites.get(id);
        if (site) {
          site.last = event;
          if (event.event === 'event-started' || event.event === 'update-started') { site.runs++; site.activatedAt = event.timestamp; }
        }
      }
    }
    this.ring[this.cursor] = event; this.cursor = (this.cursor + 1) % this.capacity;
    if (this.size === this.capacity) this.dropped++; else this.size++;
    const data = event.data;
    if (event.origin === 'browser' && event.domain === 'live') this.live(event);
    let summary: string | undefined;
    if (event.event === 'invalidate' && data.reason === 'no-active-match') summary = 'Invalidation matched no active key on this server instance';
    else if (event.event === 'missing-mutation-confirmation') summary = 'Optimistic operation supplied no confirmation';
    else if (event.event === 'subscription-fallback') summary = 'Subscription switched to direct SSE';
    else if (['subscription-error', 'optimistic-callback-failed', 'event-threw', 'update-threw'].includes(event.event)) summary = 'Diagnostic boundary reported a failure';
    else if (event.event === 'baseline-recovery') summary = 'Patch baseline required resynchronization';
    else if (event.event === 'connection-state' && data.state === 'reconnecting' && Number(data.attempt) >= 3) summary = 'Connection is repeatedly reconnecting';
    else if (event.event === 'trace-throttled') summary = 'Trace capture reached its per-second budget';
    if (summary) {
      // Sampling notices recur once per busy trace window. Keep one observation
      // per origin/scope, not eighty identical cards hiding useful failures.
      const previous = event.event === 'trace-throttled' ? this.issues.find(issue =>
        issue.event.event === event.event && issue.event.origin === event.origin && issue.event.data.scope === data.scope) : undefined;
      if (previous) { previous.event = event; previous.count++; }
      else { this.issues.push({ id: ++this.nextIssueId, event, summary, count: 1 }); if (this.issues.length > 80) this.issues.shift(); }
    }
    this.notify();
  }
  private live(event: DiagnosticEvent): void {
    const data = event.data;
    if (event.event === 'connection-state' && typeof data.connectionId === 'string') {
      if (data.state === 'closed') this.connections.delete(data.connectionId);
      else {
        this.connections.set(data.connectionId, { id: data.connectionId, transport: String(data.transport ?? 'unknown'), state: String(data.state ?? 'unknown'), attempt: Number(data.attempt ?? 0) });
        while (this.connections.size > 64) this.connections.delete(this.connections.keys().next().value!);
      }
      for (const source of this.subscriptions.values()) {
        if (source.connectionId !== data.connectionId || ['held', 'protected', 'error'].includes(source.state)) continue;
        if (data.state === 'connecting' || data.state === 'reconnecting') source.state = data.state;
        else if (data.state === 'connected' && ['connecting', 'reconnecting'].includes(source.state)) source.state = 'live';
        if (typeof data.attempt === 'number') source.attempt = data.attempt;
      }
      // A physical connection event must not recreate a closed logical source.
      return;
    }
    if (typeof data.sourceId !== 'string') return;
    if (event.event === 'source-disposed' || event.event === 'subscription-closed') { this.subscriptions.delete(data.sourceId); return; }
    const previous = this.subscriptions.get(data.sourceId);
    const item: Subscription = previous ?? { id: data.sourceId, source: String(data.source ?? 'Live source'), method: String(data.method ?? 'GET'), pending: 0, state: 'connecting', attempt: 0 };
    for (const field of ['source', 'method', 'connectionId', 'transport', 'key', 'reason', 'state'] as const) {
      if (typeof data[field] === 'string') item[field] = data[field];
    }
    for (const field of ['pending', 'sequence', 'attempt'] as const) if (typeof data[field] === 'number') item[field] = data[field];
    const stamp = data.stamp as Stamp | undefined;
    if (stamp?.key) { item.key = stamp.key; item.epoch = stamp.epoch; item.revision = stamp.revision; }
    if (event.event === 'snapshot-held') item.state = 'held';
    if (event.event === 'snapshot-applied') { item.state = 'applied'; item.reason = undefined; }
    if (event.event === 'protection-started') item.state = item.pending > 0 ? 'protected' : item.state;
    if (event.event === 'subscription-error') item.state = 'error';
    this.subscriptions.set(item.id, item);
    while (this.subscriptions.size > 256) this.subscriptions.delete(this.subscriptions.keys().next().value!);
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void {
    if (this.queued) return; this.queued = true;
    queueMicrotask(() => {
      this.queued = false; if (this.stopped) return;
      for (const listener of this.listeners) { try { listener(); } catch { /* Inspector listeners never affect app work. */ } }
    });
  }
  clear(): void { this.ring.fill(undefined); this.size = 0; this.cursor = 0; this.issues.length = 0; this.dropped = 0; for (const site of this.traceSites.values()) {site.last = undefined; site.runs = 0; site.activatedAt = undefined;} this.notify(); }
  dispose(): void { this.stopped = true; this.clear(); this.traceSites.clear(); this.subscriptions.clear(); this.connections.clear(); this.listeners.clear(); }
  report(): object { return { version: 1, exportedAt: new Date().toISOString(), scope: 'development metadata; not application payloads', dropped: this.dropped, events: this.events }; }
}

/** Capture is installed only while the panel is open, without changing console settings. */
export function captureDiagnostics(store: InspectorStore): () => void {
  const realm = globalThis as DiagnosticGlobal, previous = realm[diagnosticHook];
  let windowStart = 0, count = 0;
  const hook = { trace: true, emit(domain: 'live' | 'trace', name: string, details: unknown) {
    try {
      const now = Date.now(); if (now < windowStart || now - windowStart >= 1000) { windowStart = now; count = 0; }
      if (++count > 1000) { store.dropped++; return; }
      const event = diagnostic(domain, name, details, 'browser', now); if (event) store.accept(event);
    } catch { /* Ignore diagnostic failures. */ }
    try { previous?.emit(domain, name, details); } catch { /* A separate observer must remain isolated. */ }
  } };
  realm[diagnosticHook] = hook;
  for (const replay of realm[diagnosticProviders] ?? []) { try { replay(); } catch { /* Metadata replay is best effort. */ } }
  return () => { if (realm[diagnosticHook] === hook) { if (previous) realm[diagnosticHook] = previous; else delete realm[diagnosticHook]; } };
}

export function metadataText(data: Metadata): string {
  return JSON.stringify(data, (key, value) => key === 'code' ? undefined : value, 2);
}
