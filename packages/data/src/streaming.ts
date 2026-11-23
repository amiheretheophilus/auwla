import { getActiveEnvironment } from '@memoized-dom/runtime';
import { getActiveDataRuntime } from './active-runtime';
import { installActiveDataRestoration } from './active-restoration';
import { enableRequestEncoding } from './request-encoding';
import { fetchStoreForRuntime } from './runtime-core';
import { RequestError, isAbortError, liveFrameError } from './errors';
import { liveStamp, updateStamps, type LiveStamp } from './live-protocol';
import { LiveBaseline } from './live-baseline';
import { decodeResponse } from './request';
import { validateValue } from './schema';
import { responseStreamDecoder } from './response-decoder';
import { notifyDataRuntimeProgress } from './runtime-lifetime';
import { multiplexTransport } from './live-multiplex';
import { liveDiagnosticsEnabled, liveDiagnosticId, liveDiagnosticName, observeLiveDiagnostic, reportLiveDiagnostic } from './live-diagnostics';
import type { CoreDataRuntime } from './runtime-core';
import type { FetchEnvironment } from './resource';
import type { FetchOptions, ResolvedValue } from './types';
// One definition for both transports: `LiveBaseline` throws these, and both catch them.
import { LivePatchBaselineError, StreamProtocolError } from './stream-frames';

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
    const diagnosticId=descriptor.stream==='live'&&!getActiveEnvironment().mode.startsWith('server-')?liveDiagnosticId('direct'):undefined;
    let diagnosticState='connecting',diagnosticAttempt=0,diagnosticSequence:number|undefined;
    const diagnostic=(event:string,details:Record<string,unknown>={})=>{
      if(diagnosticId&&liveDiagnosticsEnabled())reportLiveDiagnostic(event,{
        source:liveDiagnosticName(descriptor.url),method:descriptor.method,sourceId:delivery.diagnosticSourceId,
        connectionId:diagnosticId,transport:'direct',...details,
      });
    };
    const connection=(state:string,attempt=0)=>{
      diagnosticState=state;diagnosticAttempt=attempt;diagnostic('connection-state',{state,attempt});
    };
    const releaseDiagnostic=diagnosticId?observeLiveDiagnostic(()=>{
      connection(diagnosticState,diagnosticAttempt);diagnostic('subscription-opened',{sequence:diagnosticSequence});
    }):()=>{};
    diagnostic('subscription-opened');
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
      diagnostic('subscription-error',{reason:error instanceof StreamProtocolError?'protocol-error':error instanceof RequestError?'request-error':'stream-error'});
      if (!signal.aborted) delivery.state(false, error);
      if (!seen) first.reject(error);
      completed.reject(error);
    };
    const request = async () => {
      connection('connecting',diagnosticAttempt);
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
      connection('connected');
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
      const baseline = new LiveBaseline();
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
              if (baseline.replace(frame.value, frame.seq)) baselineRecoveries = 0;
              diagnosticSequence = baseline.sequence;
              diagnostic('frame-received', { stamp, sequence: baseline.sequence });
              await deliver(baseline.current(), stamp);
            } else {
              // Older servers still deliver complete values without patch negotiation.
              baseline.reset();
              await deliver(frame.value, stamp);
            }
          } else if (event === 'patch') {
            if (descriptor.stream !== 'live') throw new StreamProtocolError('Patches are only supported for live queries');
            const stamp = liveStamp(frame.stamp);
            if (stamp === undefined) throw new StreamProtocolError('Missing live query cursor');
            baseline.patch(frame.base, frame.seq, frame.patch);
            diagnosticSequence = baseline.sequence;
            diagnostic('patch-received', { stamp, sequence: baseline.sequence });
            baselineRecoveries = 0;
            await deliver(baseline.current(), stamp);
          } else if (event === 'done') {
            if (!seen) throw new StreamProtocolError('Streaming function did not yield an initial value');
            delivery.updates(updateStamps(JSON.stringify(frame.updates ?? [])));
            delivery.state(false);
            terminal = true;
          } else if (event === 'error') {
            throw liveFrameError(frame, 'Streaming function failed');
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
            diagnostic('baseline-recovery',{reason:'patch-baseline-mismatch'});
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
        connection('reconnecting',failures+1);
        try { await delay(Math.min(1000 * 2 ** failures, 30_000), signal); }
        catch { break; }
      }
      if (!seen) first.reject(signal.reason ?? new Error('Stream aborted'));
      completed.reject(signal.reason ?? new Error('Stream aborted'));
    })().catch(fail).finally(()=>{releaseDiagnostic();diagnostic('subscription-closed');connection('closed');});
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
