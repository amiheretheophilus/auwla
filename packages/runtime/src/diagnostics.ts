/** Development-only console tracing. No DOM observers, retained history, or values. */
type TraceOptions = { component?: string; source?: string };
type TraceContext = { component?: string; eventId?: number };
type Callback<TThis, TArgs extends unknown[], TResult> = (this: TThis, ...args: TArgs) => TResult;
let context: TraceContext = {};
let eventSequence = 0;
const TRACE_WINDOW_MS = 1000;
const TRACE_WINDOW_LIMIT = 200;
let windowStarted = 0;
let windowMessages = 0;
let windowEvaluations = 0;
let windowThrottled = false;

export function diagnosticsEnabled(): boolean {
  return (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ??
    (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');
}

/** Set `globalThis.__MEMOIZED_DOM_TRACE__` from DevTools; false disables it. */
function traceConfiguration(): true | TraceOptions | undefined {
  if (!diagnosticsEnabled()) return undefined;
  try {
    const option: unknown = (globalThis as typeof globalThis & { __MEMOIZED_DOM_TRACE__?: unknown }).__MEMOIZED_DOM_TRACE__;
    if (option === true) return true;
    return option !== null && typeof option === 'object' ? option as TraceOptions : undefined;
  } catch { return undefined; }
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
        console.debug('[memoized-dom:trace] trace-throttled', {
          limit: TRACE_WINDOW_LIMIT, windowMs: TRACE_WINDOW_MS,
          evaluationLimit: TRACE_WINDOW_LIMIT / 2,
          message: 'Trace output is limited in this window. Narrow the component/source filter or disable tracing after reproducing the issue.',
        });
      }
      return;
    }
    windowMessages++; if (evaluation) windowEvaluations++;
    console.debug(`[memoized-dom:trace] ${event}`, { ...context, ...details });
  }
  catch { /* A broken console extension must never affect an application. */ }
}

/** Compiler-owned event boundary; preserves receiver, return, throws, and promises. */
export function traceEvent<TThis, TArgs extends unknown[], TResult>(
  component: string, type: string, handler: Callback<TThis, TArgs, TResult>,
): Callback<TThis, TArgs, TResult> {
  return function (this: TThis, ...args: TArgs): TResult {
    if (!traceEnabled(component)) return handler.apply(this, args);
    const previous = context;
    context = { component, eventId: ++eventSequence };
    report('event-started', { component, type });
    try {
      const result = handler.apply(this, args);
      // Do not await/subscribe to returned promises or extend a sync scope across await.
      report('event-returned', { component, type });
      return result;
    } catch (error) {
      report('event-threw', { component, type });
      throw error;
    } finally { context = previous; }
  };
}

/** Actual update invocation, not a claim that any DOM value changed. */
export function traceUpdate<TThis, TArgs extends unknown[], TResult>(
  component: string, update: Callback<TThis, TArgs, TResult>,
): Callback<TThis, TArgs, TResult> {
  return function (this: TThis, ...args: TArgs): TResult {
    if (traceConfiguration() === undefined) return update.apply(this, args);
    const enabled = traceEnabled(component);
    // Retain owner context for a binding-only source filter too.
    const previous = context;
    context = { ...previous, component };
    if (enabled) report('update-started', { component });
    try {
      const result = update.apply(this, args);
      if (enabled) report('update-completed', { component });
      return result;
    } catch (error) {
      if (enabled) report('update-threw', { component });
      throw error;
    } finally { context = previous; }
  };
}

/** Published compiler effects: these can be conservative, not observed value changes. */
export function traceWrite(component: string, sources: readonly string[], fallback = false): void {
  if (traceEnabled(component, sources)) report('write-published', { component, sources, fallback });
}

/** A binding passed its dependency gate, before its memoized value comparison. */
export function traceBinding(component: string, binding: string, sources: readonly string[]): void {
  if (traceEnabled(component, sources)) report('binding-evaluated', { component, binding, sources });
}

/** Called only after a compiler-owned DOM operation executes; never logs its value. */
export function traceDom(component: string, operation: string, sources: readonly string[] = []): void {
  if (traceEnabled(component, sources)) report('dom-write', { component, operation, sources });
}

/** Ordinary text uses a runtime equality guard rather than an emitted slot guard. */
export function traceText(component: string, node: Text, value: unknown, sources: readonly string[]): void {
  const next = value == null || typeof value === 'boolean' ? '' : String(value);
  if (node.data === next) return;
  node.data = next;
  traceDom(component, 'text', sources);
}
