/** Development-only console tracing. No DOM observers, retained history, or values. */
import { cleanup } from './cleanup';
type TraceOptions = { component?: string; source?: string };
type TraceContext = { component?: string; eventId?: number };
type Callback<TThis, TArgs extends unknown[], TResult> = (this: TThis, ...args: TArgs) => TResult;
/** Compiler-owned authored JSX address, not application state. */
type TraceLocation = { file: string; component: string; sectionLine: number; code: string; line: number; column: number; highlightStart: number; highlightEnd: number };
let context: TraceContext = {};
let eventSequence = 0;
let siteSequence = 0;
/** Attached UI sites are replayable before the first interaction. Ownership,
 * not a DOM observer or polling loop, releases them on unmount/HMR. */
function registerSite(component: string, kind: 'event' | 'conditional', location?: TraceLocation, type?: string): string | undefined {
  if (!diagnosticsEnabled()) return;
  try {
    const realm = globalThis as typeof globalThis & { [key: symbol]: Set<() => void> | undefined };
    const key = Symbol.for('memoized-dom:diagnostic-providers:v1');
    const providers = realm[key] ??= new Set();
    if (providers.size >= 512) return;
    const siteId = `trace-site-${++siteSequence}`;
    const details = { siteId, component, kind, ...(type ? {type} : {}), ...(location ? {location} : {}) };
    const replay = () => { try { inspectorHook()?.emit?.('trace', kind === 'event' ? 'event-registered' : 'region-registered', details); } catch { /* tooling only */ } };
    providers.add(replay);
    cleanup(component, () => {
      providers.delete(replay);
      try { inspectorHook()?.emit?.('trace', 'trace-site-disposed', {siteId}); } catch { /* tooling only */ }
    });
    replay(); return siteId;
  } catch { return; }
}
const TRACE_WINDOW_MS = 1000;
const TRACE_WINDOW_LIMIT = 200;
let windowStarted = 0;
let windowMessages = 0;
let windowEvaluations = 0;
let windowThrottled = false;

export function diagnosticsEnabled(): boolean {
  return (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env !== undefined && typeof (import.meta as ImportMeta & { env: { DEV?: boolean } }).env.DEV === 'boolean'
    ? (import.meta as ImportMeta & { env: { DEV?: boolean } }).env.DEV === true
    : (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');
}

/** Set `globalThis.__MEMOIZED_DOM_TRACE__` from DevTools; false disables it. */
function consoleTraceConfiguration(): true | TraceOptions | undefined {
  if (!diagnosticsEnabled()) return undefined;
  try {
    const option: unknown = (globalThis as typeof globalThis & { __MEMOIZED_DOM_TRACE__?: unknown }).__MEMOIZED_DOM_TRACE__;
    if (option === true) return true;
    return option !== null && typeof option === 'object' ? option as TraceOptions : undefined;
  } catch { return undefined; }
}

function inspectorHook(): { trace?: boolean; emit?: (domain: string, event: string, details: unknown) => void } | undefined {
  if (!diagnosticsEnabled()) return;
  try {
    return (globalThis as typeof globalThis & { [key: symbol]: ReturnType<typeof inspectorHook> })[Symbol.for('memoized-dom:diagnostics:v1')];
  } catch { return; }
}
function traceConfiguration(): true | TraceOptions | undefined {
  try { return inspectorHook()?.trace ? true : consoleTraceConfiguration(); }
  catch { return consoleTraceConfiguration(); }
}

export function traceEnabled(component?: string, sources: readonly string[] = []): boolean {
  const filter = traceConfiguration();
  if (filter === undefined) return false;
  if (filter === true) return true;
  try {
    if (filter.component !== undefined && (typeof filter.component !== 'string' || !component?.includes(filter.component))) return false;
    if (filter.source !== undefined && (typeof filter.source !== 'string' || !sources.some(source => source.includes(filter.source!)))) return false;
    return true;
  } catch { return false; }
}

function report(event: string, details: Record<string, unknown>): void {
  const publish = (name: string, metadata: Record<string, unknown>) => {
    try { inspectorHook()?.emit?.('trace', name, metadata); } catch { /* Never change application work. */ }
    const filter = consoleTraceConfiguration();
    if (!filter) return;
    if (filter !== true) {
      const component = metadata.component;
      const sources = metadata.sources;
      if (filter.component !== undefined && (typeof filter.component !== 'string' || typeof component !== 'string' || !component.includes(filter.component))) return;
      if (filter.source !== undefined && (typeof filter.source !== 'string' || !Array.isArray(sources) || !sources.some(source => typeof source === 'string' && source.includes(filter.source!)))) return;
    }
    const consoleMetadata = { ...metadata }; delete consoleMetadata.location;
    console.debug(`[memoized-dom:trace] ${name}`, consoleMetadata);
  };
  try {
    const now = Date.now();
    if (now < windowStarted || now - windowStarted >= TRACE_WINDOW_MS) {
      windowStarted = now; windowMessages = 0; windowEvaluations = 0; windowThrottled = false;
    }
    // Repeated evaluations must not consume the budget reserved for events,
    // publications, and actual DOM writes that explain a user's interaction.
    const evaluation = event === 'binding-evaluated' || event.startsWith('update-');
    if (windowMessages >= TRACE_WINDOW_LIMIT || evaluation && windowEvaluations >= TRACE_WINDOW_LIMIT / 2) {
      if (!windowThrottled) {
        windowThrottled = true;
        publish('trace-throttled', {
          ...context, ...details,
          trigger: event,
          reason: evaluation && windowEvaluations >= TRACE_WINDOW_LIMIT / 2 ? 'evaluation-budget' : 'event-budget',
          messages: windowMessages, evaluations: windowEvaluations,
          limit: TRACE_WINDOW_LIMIT, windowMs: TRACE_WINDOW_MS,
          evaluationLimit: TRACE_WINDOW_LIMIT / 2,
          message: 'Trace output is limited in this window. Narrow the component/source filter or disable tracing after reproducing the issue.',
        });
      }
      return;
    }
    windowMessages++; if (evaluation) windowEvaluations++;
    publish(event, { ...context, ...details });
  }
  catch { /* A broken console extension must never affect an application. */ }
}

/** Compiler-owned event boundary; preserves receiver, return, throws, and promises. */
export function traceEvent<TThis, TArgs extends unknown[], TResult>(
  component: string, type: string, handler: Callback<TThis, TArgs, TResult>, location?: TraceLocation,
): Callback<TThis, TArgs, TResult> {
  const siteId = registerSite(component, 'event', location, type);
  return function (this: TThis, ...args: TArgs): TResult {
    if (!traceEnabled(component)) return handler.apply(this, args);
    const previous = context;
    context = { component, eventId: ++eventSequence };
    report('event-started', { component, type, ...(siteId ? {siteId} : {}), ...(location ? { location } : {}) });
    try {
      const result = handler.apply(this, args);
      // Do not await/subscribe to returned promises or extend a sync scope across await.
      report('event-returned', { component, type, ...(siteId ? {siteId} : {}), ...(location ? { location } : {}) });
      return result;
    } catch (error) {
      report('event-threw', { component, type, ...(siteId ? {siteId} : {}), ...(location ? { location } : {}) });
      throw error;
    } finally { context = previous; }
  };
}

/** Actual update invocation, not a claim that any DOM value changed. */
export function traceUpdate<TThis, TArgs extends unknown[], TResult>(
  component: string, update: Callback<TThis, TArgs, TResult>,
  kind?: 'conditional', location?: TraceLocation,
): Callback<TThis, TArgs, TResult> {
  const siteId = kind === 'conditional' ? registerSite(component, kind, location) : undefined;
  return function (this: TThis, ...args: TArgs): TResult {
    if (traceConfiguration() === undefined) return update.apply(this, args);
    const enabled = traceEnabled(component);
    // Retain owner context for a binding-only source filter too.
    const previous = context;
    context = { ...previous, component };
    const metadata = { component, ...(siteId ? {siteId} : {}), ...(kind ? { kind } : {}), ...(location ? { location } : {}) };
    if (enabled) report('update-started', metadata);
    try {
      const result = update.apply(this, args);
      if (enabled) report('update-completed', metadata);
      return result;
    } catch (error) {
      if (enabled) report('update-threw', metadata);
      throw error;
    } finally { context = previous; }
  };
}

/** Published compiler effects: these can be conservative, not observed value changes. */
export function traceWrite(component: string, sources: readonly string[], fallback = false): void {
  if (traceEnabled(component, sources)) report('write-published', { component, sources, fallback });
}

/** A binding passed its dependency gate, before its memoized value comparison. */
export function traceBinding(component: string, binding: string, sources: readonly string[], location?: TraceLocation): void {
  if (traceEnabled(component, sources)) report('binding-evaluated', { component, binding, sources, ...(location ? { location } : {}) });
}

/** Called only after a compiler-owned DOM operation executes; never logs its value. */
export function traceDom(component: string, operation: string, sources: readonly string[] = [], location?: TraceLocation): void {
  if (traceEnabled(component, sources)) report('dom-write', { component, operation, sources, ...(location ? { location } : {}) });
}

/** Ordinary text uses a runtime equality guard rather than an emitted slot guard. */
export function traceText(component: string, node: Text, value: unknown, sources: readonly string[], location?: TraceLocation): void {
  const next = value == null || typeof value === 'boolean' ? '' : String(value);
  if (node.data === next) return;
  node.data = next;
  traceDom(component, 'text', sources, location);
}
