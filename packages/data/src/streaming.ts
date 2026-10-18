import { getActiveEnvironment } from '@memoized-dom/runtime';
import { getActiveDataRuntime } from './active-runtime';
import { installActiveDataRestoration } from './active-restoration';
import { enableRequestEncoding } from './request-encoding';
import { fetchStoreForRuntime } from './runtime-core';
import { RequestError, isAbortError } from './errors';
import { liveStamp, updateStamps, type LiveStamp } from './live-protocol';
import { applyLivePatch, type LiveJsonValue } from './live-patch';
import { decodeResponse } from './request';
import { validateValue } from './schema';
import { responseStreamDecoder } from './response-decoder';
import { notifyDataRuntimeProgress } from './runtime-lifetime';
import { multiplexTransport } from './live-multiplex';
import type { CoreDataRuntime } from './runtime-core';
import type { FetchEnvironment } from './resource';
import type { FetchOptions, ResolvedValue } from './types';

class StreamProtocolError extends Error {}
class LivePatchBaselineError extends Error {}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** The first value settles request readiness; the pump belongs to the source lifetime. */
function transport(environment: FetchEnvironment, runtime: CoreDataRuntime): NonNullable<FetchEnvironment['stream']> {
  return (descriptor, signal, delivery) => {
    const first = Promise.withResolvers<unknown>();
    const completed = Promise.withResolvers<void>();
    void completed.promise.catch(() => {});
    let seen = false;
    let last: unknown;
    let baselineRecoveries = 0;
    const value = (data: unknown, stamp?: LiveStamp) => {
      last = data;
      delivery.value(data, stamp);
      notifyDataRuntimeProgress(runtime);
      if (!seen) { seen = true; first.resolve(data); }
    };
    const fail = (error: unknown) => {
      if (!signal.aborted) delivery.state(false, error);
      if (!seen) first.reject(error);
      completed.reject(error);
    };
    const request = async () => {
      const headers = new Headers(descriptor.headers);
      const pageDecoder = responseStreamDecoder(descriptor.schema);
      const server = getActiveEnvironment().mode.startsWith('server-');
      const snapshot = server && !pageDecoder;
      headers.set('x-mmd-stream', snapshot ? 'snapshot' : descriptor.stream!);
      if (!snapshot && descriptor.stream === 'live') headers.set('x-mmd-live-patches', '2');
      else headers.delete('x-mmd-live-patches');
      if (!snapshot && pageDecoder) headers.set('x-mmd-page-stream', '1');
      const response = await environment.fetch()(descriptor.url, {
        method: descriptor.method, headers, body: descriptor.body, signal,
      });
      if (!response.ok) {
        // The same RequestError a plain request gets, message from the body.
        await decodeResponse(response, descriptor.schema);
        throw new RequestError(`Streaming request failed with status ${response.status}`, { kind: 'http', status: response.status });
      }
      if (snapshot) {
        const data = await decodeResponse(response, descriptor.schema);
        let stamp: LiveStamp | undefined;
        try { stamp = liveStamp(JSON.parse(response.headers.get('x-mmd-live') ?? 'null')); } catch {}
        value(data, stamp);
        delivery.state(false);
        return true;
      }
      if (descriptor.stream === 'page') {
        delivery.updates(updateStamps(response.headers.get('x-mmd-updates')));
        delivery.state(true);
        if (response.headers.get('x-mmd-page') === '2' && pageDecoder) {
          for await (const input of pageDecoder(response, signal)) {
            const decoded = descriptor.schema ? await validateValue(descriptor.schema, input) : input;
            if (!signal.aborted) value(decoded);
          }
        } else value(await decodeResponse(response, descriptor.schema));
        signal.throwIfAborted();
        delivery.state(false);
        return true;
      }
      if (!response.headers.get('content-type')?.includes('text/event-stream') || response.body === null) {
        await response.body?.cancel();
        throw new RequestError('Expected a streaming server-function response', { kind: 'decode' });
      }
      delivery.state(true);
      const reader = response.body.getReader();
      const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = '';
      let frameBytes = 0;
      let event = '';
      let data: string[] = [];
      let terminal = false;
      // Connection-local and never exposed: optimistic callbacks mutate delivered copies.
      let baseline: LiveJsonValue | undefined;
      let sequence: number | undefined;
      const frameSequence = (input: unknown): number => {
        if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1) {
          throw new StreamProtocolError('Invalid live patch sequence');
        }
        return input;
      };
      const deliver = async (input: unknown, stamp?: LiveStamp) => {
        const decoded = descriptor.schema ? await validateValue(descriptor.schema,input) : input;
        if (!signal.aborted) value(decoded,stamp);
      };
      const line = async (input: string) => {
        frameBytes += encoder.encode(input).byteLength + 1;
        if (frameBytes > 1_048_576) throw new StreamProtocolError('Streaming frame exceeds 1 MiB');
        if (input === '') {
          frameBytes = 0;
          if (data.length === 0) { event = ''; return; }
          const payload: unknown = JSON.parse(data.join('\n'));
          data = [];
          if (payload === null || typeof payload !== 'object') throw new StreamProtocolError('Invalid streaming frame');
          const frame = payload as Record<string, unknown>;
          if (event === 'value') {
            if (!Object.hasOwn(frame, 'value')) throw new StreamProtocolError('Missing streaming value');
            const stamp = liveStamp(frame.stamp);
            if (descriptor.stream === 'live' && stamp === undefined) throw new StreamProtocolError('Missing live query cursor');
            if (descriptor.stream === 'live' && Object.hasOwn(frame, 'seq')) {
              const nextSequence = frameSequence(frame.seq);
              if (sequence !== undefined && nextSequence === sequence + 1) baselineRecoveries = 0;
              sequence = nextSequence;
              baseline = frame.value as LiveJsonValue;
              await deliver(structuredClone(baseline), stamp);
            } else {
              // Older servers still deliver complete values without patch negotiation.
              baseline = undefined; sequence = undefined;
              await deliver(frame.value, stamp);
            }
          } else if (event === 'patch') {
            if (descriptor.stream !== 'live') throw new StreamProtocolError('Patches are only supported for live queries');
            const stamp = liveStamp(frame.stamp);
            if (stamp === undefined) throw new StreamProtocolError('Missing live query cursor');
            const base = frameSequence(frame.base), seq = frameSequence(frame.seq);
            if (seq !== base + 1) throw new StreamProtocolError('Invalid live patch sequence');
            if (baseline === undefined || sequence !== base) throw new LivePatchBaselineError('Live patch baseline mismatch');
            try { baseline = applyLivePatch(baseline, frame.patch); }
            catch { throw new StreamProtocolError('Invalid live patch operations'); }
            sequence = seq;
            baselineRecoveries = 0;
            await deliver(structuredClone(baseline), stamp);
          } else if (event === 'done') {
            if (!seen) throw new StreamProtocolError('Streaming function did not yield an initial value');
            delivery.updates(updateStamps(JSON.stringify(frame.updates ?? [])));
            delivery.state(false);
            terminal = true;
          } else if (event === 'error') {
            throw new RequestError(typeof frame.message === 'string' ? frame.message : 'Streaming function failed', { kind: 'http' });
          } else throw new StreamProtocolError(`Unknown streaming event '${event}'`);
          event = '';
          // A server render consumes the current page generation, not an
          // indefinitely open subscription. Its request remains pending until
          // all nested regions in that generation have arrived.
          if (server && pageDecoder && seen && (last as { progress?: { complete: boolean } })?.progress?.complete !== false) {
            terminal = true; delivery.state(false);
          }
          return;
        }
        if (input.startsWith('event:')) event = input.slice(6).trimStart();
        else if (input.startsWith('data:')) data.push(input.slice(5).replace(/^ /, ''));
      };
      try {
        while (!signal.aborted && !terminal) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf('\n')) !== -1 && !terminal) {
            const current = buffer.slice(0, newline).replace(/\r$/, '');
            buffer = buffer.slice(newline + 1);
            await line(current);
          }
          if (!terminal && frameBytes + encoder.encode(buffer).byteLength > 1_048_576) {
            throw new StreamProtocolError('Streaming frame exceeds 1 MiB');
          }
        }
      } finally {
        signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (signal.aborted) throw signal.reason;
      if (descriptor.stream === 'generator' && !terminal) throw new RequestError('Streaming function disconnected before completion', { kind: 'network' });
      return terminal;
    };
    void (async () => {
      let failures = 0;
      while (!signal.aborted) {
        try {
          if (await request()) { completed.resolve(); return; }
          failures = 0;
        } catch (error) {
          if (signal.aborted || isAbortError(error)) break;
          if (error instanceof LivePatchBaselineError) {
            // Only a safe live GET can resynchronize. Each new connection starts full.
            // Do not spin against a server repeatedly supplying an unusable baseline.
            if (++baselineRecoveries > 1) { fail(error); return; }
            delivery.state(true);
            continue;
          }
          // Only transient live-read transport failures retry. A declared query
          // failure, authorization denial, or invalid frame is terminal.
          if (descriptor.stream !== 'live' || error instanceof RequestError || error instanceof SyntaxError || error instanceof StreamProtocolError) {
            fail(error); return;
          }
          failures++;
        }
        delivery.state(true);
        try { await delay(Math.min(1000 * 2 ** failures, 30_000), signal); }
        catch { break; }
      }
      if (!seen) first.reject(signal.reason ?? new Error('Stream aborted'));
      completed.reject(signal.reason ?? new Error('Stream aborted'));
    })().catch(fail);
    // Suppress an unobserved rejection until FetchEntry attaches its handler.
    first.promise.catch(() => {});
    return (descriptor.stream === 'page' || getActiveEnvironment().mode.startsWith('server-') && responseStreamDecoder(descriptor.schema)
      ? completed.promise : first.promise).then(() => last);
  };
}

/** Compiler-generated server-function facade; not a new author-facing intrinsic. */
export function createStreamingSource<T>(target: string, options: FetchOptions, mode: 'live' | 'generator' | 'page'): ResolvedValue<T> {
  installActiveDataRestoration();
  const runtime = enableRequestEncoding(getActiveDataRuntime());
  const environment = fetchStoreForRuntime(runtime).environment;
  environment.stream ??= multiplexTransport(environment,runtime,transport(environment, runtime));
  return runtime.$fetch(target, { ...options, stream: mode }) as unknown as ResolvedValue<T>;
}
