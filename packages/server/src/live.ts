/** Internal invalidation and delivery protocol; no authored SSE endpoints. */
export type LiveKey = readonly (string | number | boolean | null)[];
export interface LiveStamp { epoch: string; key: string; revision: number }

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
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners!.delete(listener);
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
function frame(event: string, data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  if (json === undefined) throw new TypeError('Streaming values must be JSON serializable');
  return encoder.encode(`event: ${event}\ndata: ${json}\n\n`);
}

/** Pull-driven live query, coalescing invalidations and discarding stale in-flight reads. */
export function liveResponse(
  hub: LiveHub,
  key: string,
  request: Request,
  query: (signal: AbortSignal) => Promise<unknown>,
): Response {
  const abort = new AbortController();
  let dirty = true;
  let wake: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    disconnect();
    request.signal.removeEventListener('abort', stop);
    clearTimeout(heartbeat);
    wake?.();
  };
  const disconnect = hub.subscribe(key, () => { dirty = true; wake?.(); });
  request.signal.addEventListener('abort', stop, { once: true });
  if (request.signal.aborted) stop();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!dirty && !abort.signal.aborted) {
          await new Promise<void>(resolve => {
            wake = resolve;
            heartbeat = setTimeout(resolve, 5_000);
          });
          wake = undefined;
          clearTimeout(heartbeat);
        }
        while (dirty && !abort.signal.aborted) {
          dirty = false;
          const stamp = hub.stamp(key);
          const value = await query(abort.signal);
          if (abort.signal.aborted) break;
          if (dirty || stamp.revision !== hub.stamp(key).revision) continue;
          controller.enqueue(frame('value', { value, stamp }));
          return;
        }
        if (abort.signal.aborted) controller.close();
        else controller.enqueue(encoder.encode(': heartbeat\n\n'));
      } catch {
        if (!abort.signal.aborted) controller.enqueue(frame('error', { message: 'Live query failed' }));
        controller.close();
        stop();
      }
    },
    cancel: stop,
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
      } catch {
        if (active) controller.enqueue(frame('error', { message: 'Streaming function failed' }));
        controller.close();
        stop();
      }
    },
    cancel: stop,
  }, { highWaterMark: 1 }), { headers: {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  } });
}
