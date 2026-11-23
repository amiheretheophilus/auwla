/**
 * The shared live connection: every live read of one origin and one set of request headers
 * shares a single stream (`/_memoized/live`), and adds or removes itself through control
 * requests. Only the transport is pooled here; each read's cache, readiness and optimistic state
 * stay with its `FetchEntry`. A read the server can't serve on the shared stream, or an origin
 * without it, falls back to its own direct stream (`direct`).
 */
import { getActiveEnvironment } from '@memoized-dom/runtime';
import { RequestError, liveFrameError } from './errors';
import { abortable } from './request';
import { liveStamp } from './live-protocol';
import { LiveBaseline } from './live-baseline';
import { readStreamFrames, StreamProtocolError, LivePatchBaselineError } from './stream-frames';
import { validateValue } from './schema';
import { responseStreamDecoder } from './response-decoder';
import { notifyDataRuntimeProgress } from './runtime-lifetime';
import { liveDiagnosticsEnabled, liveDiagnosticId, liveDiagnosticName, observeLiveDiagnostic, reportLiveDiagnostic } from './live-diagnostics';
import type { CoreDataRuntime } from './runtime-core';
import type { FetchEnvironment, StreamDelivery } from './resource';

type Transport = NonNullable<FetchEnvironment['stream']>;
type Descriptor = Parameters<Transport>[0];

/** One live read on the shared connection. */
interface Slot {
  /** Its subscription id on the connection; a recovery gives it a new one. */
  id: string;
  descriptor: Descriptor;
  signal: AbortSignal;
  delivery: StreamDelivery;
  /** Settles with the first value, or the failure before it. */
  first: ReturnType<typeof Promise.withResolvers<unknown>>;
  baseline: LiveBaseline;
  /** Baseline recoveries since the last frame that followed on in sequence. */
  recoveries: number;
  /** Bytes received and not yet handled, against the per-read limit. */
  bytes: number;
  /** Frames are handled one after another, in order. */
  chain: Promise<void>;
  remove: () => void;
}

class SessionExpired extends Error {}

const endpoint = '/_memoized/live';
/** Per-read and per-connection limits on frames received and not yet handled. */
const SLOT_BYTES = 2_097_152;
const CONNECTION_BYTES = 8_388_608;

let nextId = 1;
const identity = () => `q${nextId++}`;

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Pool only transport; FetchEntry retains cache, readiness and optimistic ownership. */
export function multiplexTransport(environment: FetchEnvironment, runtime: CoreDataRuntime, direct: Transport): Transport {
  const channels = new Map<string, Channel>();
  /** Origins that answered the shared endpoint with 404 or 405: every read there goes direct. */
  const unsupported = new Set<string>();
  /** Paths the server sent to their own stream (`fallback`): later reads of them go direct too. */
  const bypass = new Set<string>();

  class Channel {
    readonly slots = new Map<string, Slot>();
    readonly lifetime = new AbortController();
    controller?: AbortController;
    /** The session id the server gave this connection, once its first frame arrives. */
    token?: string;
    /** Subscription ids the server has been told about. */
    remote = new Set<string>();
    revision = 1;
    /** Counts connections: frames and controls of an older one are ignored. */
    generation = 0;
    bytes = 0;
    scheduled = false;
    running = false;
    controlling = false;
    reconnectReason: unknown;
    private readonly diagnosticId = liveDiagnosticId('multiplex');
    private diagnosticState = 'connecting';
    private diagnosticAttempt = 0;
    private readonly releaseDiagnostic: () => void;

    constructor(readonly key: string, readonly origin: string, readonly headers: Headers) {
      this.releaseDiagnostic = observeLiveDiagnostic(() => {
        this.connectionDiagnostic(this.diagnosticState, this.diagnosticAttempt);
        for (const slot of this.slots.values()) this.diagnostic('subscription-opened', slot, { sequence: slot.baseline.sequence });
      });
    }

    diagnostic(event: string, slot: Slot, details: Record<string, unknown> = {}): void {
      if (!this.diagnosticId || !liveDiagnosticsEnabled()) return;
      reportLiveDiagnostic(event, {
        source: liveDiagnosticName(slot.descriptor.url),
        method: slot.descriptor.method,
        sourceId: slot.delivery.diagnosticSourceId,
        connectionId: this.diagnosticId,
        subscriptionId: slot.id,
        transport: 'multiplexed',
        ...details,
      });
    }

    connectionDiagnostic(state: string, attempt = 0): void {
      this.diagnosticState = state;
      this.diagnosticAttempt = attempt;
      if (!this.diagnosticId || !liveDiagnosticsEnabled()) return;
      reportLiveDiagnostic('connection-state', { connectionId: this.diagnosticId, transport: 'multiplexed', state, attempt });
    }

    subscribe(descriptor: Descriptor, signal: AbortSignal, delivery: StreamDelivery): Promise<unknown> {
      const slot: Slot = {
        id: identity(), descriptor, signal, delivery, first: Promise.withResolvers<unknown>(),
        baseline: new LiveBaseline(), recoveries: 0, bytes: 0, chain: Promise.resolve(), remove: () => {},
      };
      slot.first.promise.catch(() => {});
      slot.remove = () => {
        if (this.slots.get(slot.id) !== slot) return;
        this.slots.delete(slot.id);
        signal.removeEventListener('abort', slot.remove);
        this.diagnostic('subscription-closed', slot);
        slot.first.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        this.schedule();
      };
      this.slots.set(slot.id, slot);
      signal.addEventListener('abort', slot.remove, { once: true });
      this.diagnostic('subscription-opened', slot);
      if (signal.aborted) {
        slot.remove();
      } else {
        if (this.running) delivery.state(true);
        this.schedule();
      }
      return slot.first.promise;
    }

    fail(slot: Slot, error: unknown): void {
      if (this.slots.get(slot.id) !== slot) return;
      this.slots.delete(slot.id);
      slot.signal.removeEventListener('abort', slot.remove);
      const reason = error instanceof StreamProtocolError ? 'protocol-error'
        : error instanceof RequestError ? 'request-error' : 'stream-error';
      this.diagnostic('subscription-error', slot, { reason });
      if (!slot.signal.aborted) slot.delivery.state(false, error);
      slot.first.reject(error);
      this.schedule();
    }

    /** Move a read to its own direct stream, and send later reads of its path there too. */
    fallback(slot: Slot, reason = 'response-requires-direct-transport'): void {
      if (this.slots.get(slot.id) !== slot) return;
      this.diagnostic('subscription-fallback', slot, { reason });
      bypass.add(new URL(slot.descriptor.url, this.origin).pathname);
      this.slots.delete(slot.id);
      slot.signal.removeEventListener('abort', slot.remove);
      this.schedule();
      void direct(slot.descriptor, slot.signal, slot.delivery).then(slot.first.resolve, slot.first.reject);
    }

    /** Once per microtask: close an empty connection, open one, or send the changed subscriptions. */
    schedule(): void {
      if (this.scheduled) return;
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        if (!this.slots.size) {
          this.releaseDiagnostic();
          this.connectionDiagnostic('closed');
          this.lifetime.abort();
          this.controller?.abort();
          channels.delete(this.key);
          return;
        }
        if (!this.running) {
          this.running = true;
          void this.run();
        } else if (this.token) {
          void this.controls();
        }
      });
    }

    descriptors(ids: Iterable<string>): { id: string; url: string; page: boolean }[] {
      return [...ids].flatMap((id) => {
        const slot = this.slots.get(id);
        if (!slot) return [];
        const url = new URL(slot.descriptor.url, this.origin);
        return [{ id, url: url.pathname + url.search, page: !!responseStreamDecoder(slot.descriptor.schema) }];
      });
    }

    /** Tell the server which reads joined or left, until it knows them all. */
    async controls(): Promise<void> {
      if (this.controlling || !this.token || !this.controller) return;
      this.controlling = true;
      const controller = this.controller;
      const generation = this.generation;
      try {
        while (this.token && !controller.signal.aborted && generation === this.generation) {
          const subscribe = this.descriptors([...this.slots.keys()].filter((id) => !this.remote.has(id)));
          const unsubscribe = [...this.remote].filter((id) => !this.slots.has(id));
          if (!subscribe.length && !unsubscribe.length) return;
          const response = await environment.fetch()(this.origin + endpoint, {
            method: 'POST', headers: this.requestHeaders(), signal: controller.signal,
            body: JSON.stringify({ version: 1, session: this.token, revision: this.revision + 1, subscribe, unsubscribe }),
          });
          await response.body?.cancel();
          if (response.status === 409) throw new SessionExpired('Live session expired');
          // A session belongs to the credentials that opened it; after sign-in
          // or sign-out the server refuses it. Reopen as the current reader.
          if (response.status === 403) throw new SessionExpired('Live session credentials changed');
          if (response.status !== 204) throw new RequestError('Live subscription control rejected', { kind: 'http', status: response.status });
          this.revision++;
          for (const id of unsubscribe) this.remote.delete(id);
          for (const item of subscribe) this.remote.add(item.id);
        }
      } catch (error) {
        if (generation === this.generation && !controller.signal.aborted) {
          this.reconnectReason = error;
          controller.abort();
        }
      } finally {
        this.controlling = false;
        if (this.controller !== controller) this.schedule();
      }
    }

    requestHeaders(): Headers {
      const headers = new Headers(this.headers);
      headers.set('content-type', 'application/json');
      headers.set('x-mmd-multiplex', '1');
      return headers;
    }

    /** One frame from the shared stream. Each read's frames are handled in order, on its chain. */
    receive(event: string, frame: Record<string, unknown>, size: number, generation: number, signal: AbortSignal): void {
      if (event === 'session') {
        if (this.token || frame.version !== 1 || typeof frame.session !== 'string' || !/^[-\w]{1,128}$/.test(frame.session)) {
          throw new StreamProtocolError('Invalid live session');
        }
        this.token = frame.session;
        this.schedule();
        return;
      }
      if (event === 'session-error') {
        throw new StreamProtocolError(typeof frame.message === 'string' ? frame.message : 'Live session failed');
      }
      if (!this.token || typeof frame.sub !== 'string' || !/^[-\w]{1,80}$/.test(frame.sub)) {
        throw new StreamProtocolError('Missing live subscription identity');
      }
      const slot = this.slots.get(frame.sub);
      if (!slot) return; // Late frames for retired subscriptions are inert.
      const id = slot.id;
      if (slot.bytes + size > SLOT_BYTES || this.bytes + size > CONNECTION_BYTES) {
        this.fail(slot, new StreamProtocolError('Live subscription delivery capacity exceeded'));
        return;
      }
      slot.bytes += size;
      this.bytes += size;
      const current = () => this.generation === generation && this.slots.get(id) === slot && slot.id === id && !signal.aborted;

      slot.chain = slot.chain.then(async () => {
        if (!current()) return;
        if (event === 'fallback') {
          this.fallback(slot);
          return;
        }
        if (event === 'error') throw liveFrameError(frame, 'Live query failed');
        const stamp = liveStamp(frame.stamp);
        if (!stamp) throw new StreamProtocolError('Missing live query cursor');
        if (event === 'value') {
          if (!Object.hasOwn(frame, 'value')) throw new StreamProtocolError('Missing streaming value');
          if (slot.baseline.replace(frame.value, frame.seq)) slot.recoveries = 0;
        } else if (event === 'patch') {
          slot.baseline.patch(frame.base, frame.seq, frame.patch);
          slot.recoveries = 0;
        } else {
          throw new StreamProtocolError(`Unknown streaming event '${event}'`);
        }
        const input = slot.baseline.current();
        this.diagnostic(event === 'patch' ? 'patch-received' : 'frame-received', slot, { stamp, sequence: slot.baseline.sequence });
        const schema = slot.descriptor.schema;
        const value = schema ? await abortable(() => validateValue(schema, input), signal) : input;
        if (generation !== this.generation || this.slots.get(id) !== slot || slot.signal.aborted || signal.aborted) return;
        slot.delivery.value(value, stamp);
        notifyDataRuntimeProgress(runtime);
        slot.first.resolve(value);
      }).catch((error) => {
        if (this.generation !== generation || this.slots.get(id) !== slot || signal.aborted) return;
        // A patch that doesn't fit: subscribe again under a new id, for a fresh full value. Once.
        if (error instanceof LivePatchBaselineError && ++slot.recoveries <= 1) {
          this.diagnostic('baseline-recovery', slot, { reason: 'patch-baseline-mismatch' });
          this.slots.delete(id);
          slot.id = identity();
          slot.baseline.reset();
          this.slots.set(slot.id, slot);
          this.schedule();
        } else {
          this.fail(slot, error);
        }
      }).finally(() => {
        if (generation === this.generation) {
          slot.bytes -= size;
          this.bytes -= size;
        }
      });
    }

    /** Hold the connection open, reconnecting with backoff, while any read is subscribed. */
    async run(): Promise<void> {
      let failures = 0;
      try {
        while (this.slots.size && !this.lifetime.signal.aborted) {
          const controller = new AbortController();
          this.controller = controller;
          this.token = undefined;
          this.reconnectReason = undefined;
          this.generation++;
          this.bytes = 0;
          this.revision = 1;
          const generation = this.generation;
          const subscribe = this.descriptors(this.slots.keys());
          this.remote = new Set(subscribe.map((item) => item.id));
          this.connectionDiagnostic('connecting', failures);
          // A new connection starts every read from a full value.
          for (const slot of this.slots.values()) {
            slot.baseline.reset();
            slot.bytes = 0;
            slot.delivery.state(true);
          }
          let failure: unknown;
          try {
            const response = await environment.fetch()(this.origin + endpoint, {
              method: 'POST', headers: this.requestHeaders(), signal: controller.signal,
              body: JSON.stringify({ version: 1, revision: 1, subscribe, unsubscribe: [], contentType: this.headers.get('content-type') ?? undefined }),
            });
            if ([404, 405].includes(response.status)) {
              await response.body?.cancel();
              unsupported.add(this.origin);
              for (const slot of Array.from(this.slots.values())) this.fallback(slot, 'multiplex-unavailable');
              return;
            }
            if (!response.ok) {
              await response.body?.cancel();
              throw new RequestError('Live session rejected', { kind: 'http', status: response.status });
            }
            if (response.headers.get('x-mmd-multiplex') !== '1') {
              await response.body?.cancel();
              throw new StreamProtocolError('Unsupported live multiplex protocol');
            }
            this.connectionDiagnostic('connected');
            await readStreamFrames(response, controller.signal, (event, frame, size) => this.receive(event, frame, size, generation, controller.signal));
            failure = new Error('Live connection disconnected');
          } catch (error) {
            failure = this.reconnectReason ?? error;
          } finally {
            controller.abort();
            this.token = undefined;
          }
          if (!this.slots.size || this.lifetime.signal.aborted) return;
          // A refusal or a broken protocol won't heal by reconnecting: fail every read.
          if (failure instanceof RequestError || failure instanceof StreamProtocolError || failure instanceof SyntaxError) {
            for (const slot of Array.from(this.slots.values())) this.fail(slot, failure);
            return;
          }
          for (const slot of this.slots.values()) slot.delivery.state(true);
          this.connectionDiagnostic('reconnecting', failures + 1);
          await delay(Math.min(1000 * 2 ** Math.min(failures++, 5), 30_000), this.lifetime.signal);
        }
      } catch (error) {
        if (!this.lifetime.signal.aborted) {
          for (const slot of Array.from(this.slots.values())) this.fail(slot, error);
        }
      } finally {
        this.running = false;
        this.controller?.abort();
        if (!this.slots.size) channels.delete(this.key);
      }
    }
  }

  return (descriptor, signal, delivery) => {
    let url: URL;
    let origin: string;
    try {
      url = new URL(descriptor.url, environment.baseURL);
      origin = new URL(String(environment.baseURL)).origin;
    } catch {
      return direct(descriptor, signal, delivery);
    }
    // Only a browser's live GET of its own server functions shares the connection.
    const shared = !getActiveEnvironment().mode.startsWith('server-')
      && descriptor.stream === 'live' && descriptor.method === 'GET' && url.origin === origin
      && !(typeof location !== 'undefined' && location.origin !== url.origin)
      && url.pathname.startsWith('/_fn/') && !unsupported.has(origin) && !bypass.has(url.pathname);
    if (!shared) return direct(descriptor, signal, delivery);
    const headers = new Headers(descriptor.headers);
    const key = origin + '|' + JSON.stringify([...headers].sort(([a], [b]) => a.localeCompare(b)));
    let channel = channels.get(key);
    if (!channel) {
      channel = new Channel(key, origin, headers);
      channels.set(key, channel);
    }
    return channel.subscribe(descriptor, signal, delivery);
  };
}
