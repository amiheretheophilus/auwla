import { encodeLiveFrame as frame, LivePatchEncoder } from './live-patch';
import { liveDiagnosticsEnabled, reportLiveDiagnostic, liveDiagnosticName } from '@memoized-dom/data/internal';
import { isServerPageUpdates, type ServerPageUpdates } from './page-definition';
import type { PageContent } from '@memoized-dom/runtime';

/** Internal invalidation and delivery protocol; no authored SSE endpoints. */
export type LiveKey = readonly (string | number | boolean | null)[];
export interface LiveStamp { epoch: string; key: string; revision: number }
type StreamErrorReporter = (error: unknown) => void | Promise<void>;

export async function reportStreamError(error: unknown, request: Request, report?: StreamErrorReporter): Promise<void> {
  if (report === undefined) {
    console.error(`[memoized-dom] Stream failed: ${request.method} ${new URL(request.url).pathname}`, error);
    return;
  }
  try { await report(error); }
  catch (reportError) {
    console.error('[memoized-dom] Stream error reporter failed', reportError);
    console.error('[memoized-dom] Original stream failure', error);
  }
}

export class LiveHub {
  readonly epoch = crypto.randomUUID();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Map<string, Set<() => void>>();
  /** Active query keys below each structural prefix; unrelated families are never scanned. */
  private readonly descendants = new Map<string, Set<string>>();
  private revision = 0;
  onActivity: ((active: boolean) => void) | undefined;

  key(key: LiveKey): string {
    if (!Array.isArray(key) || key.length === 0 || key.some(part =>
      part !== null && typeof part !== 'string' && typeof part !== 'boolean' &&
      (typeof part !== 'number' || !Number.isFinite(part)))) {
      throw new TypeError('Live keys must be nonempty arrays of finite JSON primitives');
    }
    return JSON.stringify(key);
  }
  stamp(key: string): LiveStamp {
    return { epoch: this.epoch, key, revision: this.revisions.get(key) ?? this.revision };
  }
  private prefixes(key: LiveKey): string[] {
    const prefixes: string[] = [];
    for (let length = 1; length <= key.length; length++) prefixes.push(JSON.stringify(key.slice(0, length)));
    return prefixes;
  }
  invalidate(input: LiveKey): LiveStamp {
    const key = this.key(input);
    const revision = ++this.revision;
    const affected = new Set(this.descendants.get(key));
    for (const prefix of this.prefixes(input)) {
      if (this.listeners.has(prefix)) affected.add(prefix);
    }
    // Advance every affected query before waking any of them. One mutation
    // cursor covers its ancestors and descendants without an expanding header.
    for (const query of affected) this.revisions.set(query, revision);
    if (liveDiagnosticsEnabled()) reportLiveDiagnostic('invalidate', {
      key, revision, epoch: this.epoch, matchedKeys: [...affected],
      subscribers: [...affected].reduce((count, query) => count + (this.listeners.get(query)?.size ?? 0), 0),
      // An empty match can be legitimate: no query may be mounted yet.
      reason: affected.size === 0 ? 'no-active-match' : 'matched',
    });
    for (const query of affected) {
      for (const listener of [...this.listeners.get(query) ?? []]) listener();
    }
    return { epoch: this.epoch, key, revision };
  }
  subscribe(key: string, listener: () => void): () => void {
    const prefixes = this.prefixes(JSON.parse(key) as LiveKey);
    let listeners = this.listeners.get(key);
    if (listeners === undefined) {
      const activate = this.listeners.size === 0;
      this.listeners.set(key, listeners = new Set());
      this.revisions.set(key, this.revision);
      for (const prefix of prefixes) {
        let queries = this.descendants.get(prefix);
        if (queries === undefined) this.descendants.set(prefix, queries = new Set());
        queries.add(key);
      }
      if (activate) this.onActivity?.(true);
    }
    listeners.add(listener);
    if (liveDiagnosticsEnabled()) reportLiveDiagnostic('subscribe', { key, subscribers: listeners.size, epoch: this.epoch });
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners!.delete(listener);
      if (liveDiagnosticsEnabled()) reportLiveDiagnostic('unsubscribe', { key, subscribers: listeners!.size, epoch: this.epoch });
      if (listeners!.size === 0) {
        this.listeners.delete(key); this.revisions.delete(key);
        for (const prefix of prefixes) {
          const queries = this.descendants.get(prefix)!;
          queries.delete(key);
          if (queries.size === 0) this.descendants.delete(prefix);
        }
        if (this.listeners.size === 0) this.onActivity?.(false);
      }
    };
  }
}

const hubs = new WeakMap<object, LiveHub>();
export function liveHub(services: object): LiveHub {
  let hub = hubs.get(services);
  if (hub === undefined) hubs.set(services, hub = new LiveHub());
  return hub;
}

const encoder = new TextEncoder();

export interface LiveQueryValue { value: unknown; stamp: LiveStamp }
export interface LiveSubscription {
  next(): Promise<IteratorResult<LiveQueryValue>>;
  cancel(): void;
  fail(error:unknown):void;
}

/** Transport-independent query lifetime: one pending read, no heartbeat or wire queue. */
export function createLiveSubscription(
  hub: LiveHub,
  key: string,
  request: Request,
  query: (signal: AbortSignal) => Promise<unknown>,
  onError?: StreamErrorReporter,
): LiveSubscription {
  const abort = new AbortController();
  let dirty = true;
  let wake: (() => void) | undefined;
  let rendering: { updates: ServerPageUpdates; iterator: AsyncIterator<PageContent>; stamp: LiveStamp } | undefined;
  let committed = false;
  const releaseRender = () => {
    const previous = rendering; rendering = undefined;
    previous?.updates.cancel();
    void previous?.iterator.return?.().catch(() => {});
  };
  const stop = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    disconnect();
    request.signal.removeEventListener('abort', stop);
    releaseRender();
    wake?.();
  };
  const disconnect = hub.subscribe(key, () => { dirty = true; rendering?.updates.cancel(); wake?.(); });
  request.signal.addEventListener('abort', stop, { once: true });
  if (request.signal.aborted) stop();
  return {
    cancel: stop,
    fail(error){stop();void reportStreamError(error,request,onError);},
    async next() {
      try {
        const deliver = (value: unknown, stamp: LiveStamp): IteratorResult<LiveQueryValue> => {
          if (liveDiagnosticsEnabled()) reportLiveDiagnostic('query-delivered', { source: liveDiagnosticName(request.url), stamp });
          return {done:false,value:{value,stamp}};
        };
        while (!abort.signal.aborted) {
          if (dirty) {
            releaseRender(); dirty = false;
            const stamp = hub.stamp(key);
            if (liveDiagnosticsEnabled()) reportLiveDiagnostic('query-started', { source: liveDiagnosticName(request.url), stamp });
            const value = await query(abort.signal);
            if (abort.signal.aborted) { if (isServerPageUpdates(value)) value.cancel(); break; }
            if (dirty || stamp.revision !== hub.stamp(key).revision) {
              if (isServerPageUpdates(value)) value.cancel();
              if (liveDiagnosticsEnabled()) reportLiveDiagnostic('query-discarded', {
                reason: 'invalidated-during-read', source: liveDiagnosticName(request.url), stamp, current: hub.stamp(key),
              });
              continue;
            }
            if (isServerPageUpdates(value)) rendering = { updates: value, iterator: value[Symbol.asyncIterator](), stamp };
            else { committed = true; return deliver(value, stamp); }
          }
          if (rendering) {
            const current = rendering;
            let next: IteratorResult<PageContent>;
            try { next = await current.iterator.next(); }
            catch (error) { if (dirty && !abort.signal.aborted) { releaseRender(); continue; } throw error; }
            if (abort.signal.aborted) break;
            if (dirty || current.stamp.revision !== hub.stamp(key).revision) { dirty = true; releaseRender(); continue; }
            if (next.done) { releaseRender(); continue; }
            // First visits reveal ready regions; revalidations retain the last
            // complete result instead of flashing nested loading fallbacks.
            if (committed && next.value.progress?.complete === false) continue;
            if (next.value.progress?.complete !== false) committed = true;
            return deliver(next.value, current.stamp);
          }
          await new Promise<void>(resolve => { wake = resolve; });
          wake = undefined;
        }
        return {done:true,value:undefined};
      } catch (error) {
        const failed = !abort.signal.aborted;
        stop();
        if (!failed) return {done:true,value:undefined};
        void reportStreamError(error,request,onError);
        throw error;
      }
    },
  };
}

/** Direct SSE remains a supported transport over the same subscription engine. */
export function liveResponse(hub: LiveHub, key: string, request: Request,
  query: (signal: AbortSignal) => Promise<unknown>, onError?: StreamErrorReporter,
): Response {
  const subscription=createLiveSubscription(hub,key,request,query,onError);
  const version=request.headers.get('x-mmd-live-patches');
  const patches=version==='1'||version==='2'?new LivePatchEncoder(version==='2'):undefined;
  let pending:Promise<IteratorResult<LiveQueryValue>>|undefined;
  let heartbeat:ReturnType<typeof setTimeout>|undefined;
  let wake:(()=>void)|undefined;
  let stopped=false;
  const stop=()=>{if(stopped)return;stopped=true;subscription.cancel();clearTimeout(heartbeat);wake?.();request.signal.removeEventListener('abort',stop);};
  request.signal.addEventListener('abort',stop,{once:true});
  if(request.signal.aborted)stop();
  const body=new ReadableStream<Uint8Array>({
    async pull(controller){
      try{
        if(stopped){controller.close();return;}
        pending??=subscription.next();
        const next=await Promise.race([pending,new Promise<null>(resolve=>{wake=()=>resolve(null);heartbeat=setTimeout(wake,5_000);})]);
        clearTimeout(heartbeat);wake=undefined;
        if(stopped){controller.close();return;}
        if(next===null){controller.enqueue(encoder.encode(': heartbeat\n\n'));return;}
        pending=undefined;
        if(next.done){controller.close();stop();return;}
        const {value,stamp}=next.value;
        try{controller.enqueue(patches?patches.encode(value,stamp):frame('value',{value,stamp}));}
        catch(error){subscription.fail(error);throw error;}
      }catch{
        if(!stopped){controller.enqueue(frame('error',{message:'Live query failed'}));controller.close();}
        stop();
      }
    },cancel:stop,
  }, { highWaterMark: 1 });
  return new Response(body, { headers: {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  } });
}

/** Finite generator transport: completion is explicit, and disconnect never restarts it. */
export function generatorResponse(
  request: Request,
  iterator: AsyncIterator<unknown>,
  cancel: () => void,
  onComplete: () => LiveStamp[] = () => [],
  onError?: StreamErrorReporter,
): Response {
  let active = true;
  let delivered = false;
  let last: unknown;
  const stop = () => {
    if (!active) return;
    active = false;
    request.signal.removeEventListener('abort', stop);
    cancel();
    void iterator.return?.().catch(() => {});
  };
  request.signal.addEventListener('abort', stop, { once: true });
  if (request.signal.aborted) stop();
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!active) { controller.close(); return; }
      try {
        const next = await iterator.next();
        if (!active) { controller.close(); return; }
        if (!next.done) {
          delivered = true;
          last = next.value;
          controller.enqueue(frame('value', { value: last }));
        } else {
          if (!delivered) throw new Error('A streaming function must yield at least one value');
          // A return value is control flow, not another published payload.
          controller.enqueue(frame('done', { updates: onComplete() }));
          controller.close();
          stop();
        }
      } catch (error) {
        const failed = active;
        try {
          if (failed) controller.enqueue(frame('error', { message: 'Streaming function failed' }));
          controller.close();
        } finally {
          stop();
          if (failed) void reportStreamError(error, request, onError);
        }
      }
    },
    cancel: stop,
  }, { highWaterMark: 1 }), { headers: {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  } });
}
