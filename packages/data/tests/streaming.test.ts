import { afterEach, describe, expect, it } from 'bun:test';
import { $forms, createDataRuntime, runWithDataRuntime } from '../src/index';
import { createStreamingSource } from '../src/streaming';
import { trackResolvedValue } from '../src/transparent';
import { disposeFetchResource, resourceController } from '../src/resource';
import { protectLiveSources } from '../src/source-protection';
import type { FetchResource } from '../src/types';
import { waitFor } from '../../../test-support/helpers';

const encoder = new TextEncoder();
const channels: ReadableStreamDefaultController<Uint8Array>[] = [];
const runtimes: ReturnType<typeof createDataRuntime>[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.clear(); channels.length = 0; });
function frame(event: string, data: unknown) { return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function feed<T = number>(mode: 'live' | 'generator' = 'live') {
  let cancelled = 0;
  const runtime = createDataRuntime({ baseURL: 'https://app.test', fetch: async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { channels.push(controller); }, cancel() { cancelled++; },
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  runtimes.push(runtime);
  const source = runWithDataRuntime(runtime, () => createStreamingSource<T>('/value', {}, mode));
  const holder = source as unknown as FetchResource<T>;
  const tracker = trackResolvedValue(source);
  return { runtime, holder, source, tracker, cancelled: () => cancelled };
}
const stamp = (revision: number, key = 'notes') => ({ epoch: 'test', key, revision });

describe('compiler-owned streaming sources', () => {
  it('reconstructs patches privately while multiple optimistic operations protect visible data', async () => {
    const { runtime, holder, source } = feed<{ id: string }[]>();
    channels[0]!.enqueue(frame('value', { value: [{ id: 'A' }], stamp: stamp(0), seq: 1 }));
    await runtime.settle();
    const first = protectLiveSources(source), second = protectLiveSources(source);
    holder.data!.push({ id: 'temporary' });
    channels[0]!.enqueue(frame('patch', { base: 1, seq: 2, stamp: stamp(1), patch: [{ op: 'add', path: '/1', value: { id: 'B' } }] }));
    channels[0]!.enqueue(frame('patch', { base: 2, seq: 3, stamp: stamp(2), patch: [{ op: 'add', path: '/2', value: { id: 'C' } }] }));
    await waitFor(() => expect(resourceController(holder).entry!.protection.stamp?.revision).toBe(2));
    expect(holder.data).toEqual([{ id: 'A' }, { id: 'temporary' }]);
    first(); expect(holder.data).toEqual([{ id: 'A' }, { id: 'temporary' }]);
    second(); expect(holder.data).toEqual([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
    // Reconciliation and arbitrary visible edits cannot modify the wire baseline.
    holder.data!.push({ id: 'visible-only' });
    channels[0]!.enqueue(frame('patch', { base: 3, seq: 4, stamp: stamp(3), patch: [{ op: 'replace', path: '/0/id', value: 'changed' }] }));
    await waitFor(() => expect(holder.data).toEqual([{ id: 'changed' }, { id: 'B' }, { id: 'C' }]));
  });

  it('uses empty patches to confirm mutations without releasing an older buffered snapshot', async () => {
    const { runtime, holder } = feed<{ count: number }>();
    channels[0]!.enqueue(frame('value', { value: { count: 0 }, stamp: stamp(0), seq: 1 }));
    await runtime.settle();
    const protection = resourceController(holder).entry!.protection;
    const release = protection.protect();
    holder.data!.count = 10;
    channels[0]!.enqueue(frame('patch', { base: 1, seq: 2, stamp: stamp(1), patch: [{ op: 'replace', path: '/count', value: 1 }] }));
    await waitFor(() => expect(protection.stamp?.revision).toBe(1));
    release([stamp(2)]); expect(holder.data!.count).toBe(10);
    channels[0]!.enqueue(frame('patch', { base: 2, seq: 3, stamp: stamp(2), patch: [] }));
    await waitFor(() => expect(holder.data!.count).toBe(1));
  });

  it('adopts a fallback full baseline while protected and continues patching from it', async () => {
    const { runtime, holder, source } = feed<{ count: number }>();
    channels[0]!.enqueue(frame('value', { value: { count: 0 }, stamp: stamp(0), seq: 1 }));
    await runtime.settle();
    const release = protectLiveSources(source);
    holder.data!.count = 10;
    channels[0]!.enqueue(frame('patch', { base: 1, seq: 2, stamp: stamp(1), patch: [{ op: 'replace', path: '/count', value: 1 }] }));
    channels[0]!.enqueue(frame('value', { value: { count: 2 }, stamp: stamp(2), seq: 3 }));
    channels[0]!.enqueue(frame('patch', { base: 3, seq: 4, stamp: stamp(3), patch: [{ op: 'replace', path: '/count', value: 3 }] }));
    await waitFor(() => expect(resourceController(holder).entry!.protection.stamp?.revision).toBe(3));
    expect(holder.data!.count).toBe(10);
    release(); expect(holder.data!.count).toBe(3);
  });

  it('shares a live source without sharing its private baseline with visible consumers', async () => {
    const { runtime, holder } = feed<{ count: number }>();
    const other = runWithDataRuntime(runtime, () => createStreamingSource<{ count: number }>('/value', {}, 'live')) as unknown as FetchResource<{ count: number }>;
    expect(channels).toHaveLength(1);
    channels[0]!.enqueue(frame('value', { value: { count: 0 }, stamp: stamp(0), seq: 1 }));
    await runtime.settle();
    other.data!.count = 10;
    channels[0]!.enqueue(frame('patch', { base: 1, seq: 2, stamp: stamp(1), patch: [] }));
    await waitFor(() => expect(holder.data!.count).toBe(0));
    expect(other.data).toBe(holder.data);
  });

  it('allows another baseline recovery after demonstrated full-snapshot progress', async () => {
    const { runtime, holder, tracker } = feed();
    channels[0]!.enqueue(frame('value', { value: 0, stamp: stamp(0), seq: 1 }));
    await runtime.settle();
    channels[0]!.enqueue(frame('patch', { base: 4, seq: 5, stamp: stamp(1), patch: [] }));
    await waitFor(() => expect(channels).toHaveLength(2));
    channels[1]!.enqueue(frame('value', { value: 1, stamp: stamp(1), seq: 1 }));
    channels[1]!.enqueue(frame('value', { value: 2, stamp: stamp(2), seq: 2 }));
    await waitFor(() => expect(holder.data).toBe(2));
    channels[1]!.enqueue(frame('patch', { base: 4, seq: 5, stamp: stamp(3), patch: [] }));
    await waitFor(() => expect(channels).toHaveLength(3));
    channels[2]!.enqueue(frame('value', { value: 3, stamp: stamp(3), seq: 1 }));
    await waitFor(() => expect(holder.data).toBe(3));
    expect(tracker.error).toBeNull();
  });

  it('reconnects with a fresh full baseline after a sequence mismatch and cancels the old reader', async () => {
    const { runtime, holder, tracker, cancelled } = feed();
    channels[0]!.enqueue(frame('value', { value: 1, stamp: stamp(0), seq: 1 }));
    await runtime.settle();
    channels[0]!.enqueue(frame('patch', { base: 3, seq: 4, stamp: stamp(1), patch: [] }));
    await waitFor(() => expect(channels).toHaveLength(2));
    expect(cancelled()).toBe(1); expect(holder.data).toBe(1);
    channels[1]!.enqueue(frame('value', { value: 5, stamp: stamp(5), seq: 1 }));
    channels[1]!.enqueue(frame('patch', { base: 1, seq: 2, stamp: stamp(6), patch: [{ op: 'replace', path: '', value: 6 }] }));
    await waitFor(() => expect(holder.data).toBe(6));
    expect(tracker.error).toBeNull();
  });

  it('bounds recovery attempts and rejects malformed patch operations without losing prior data', async () => {
    const { runtime, holder, tracker } = feed();
    channels[0]!.enqueue(frame('value', { value: 1, stamp: stamp(0), seq: 1 }));
    await runtime.settle();
    channels[0]!.enqueue(frame('patch', { base: 4, seq: 5, stamp: stamp(1), patch: [] }));
    await waitFor(() => expect(channels).toHaveLength(2));
    channels[1]!.enqueue(frame('value', { value: 2, stamp: stamp(2), seq: 1 }));
    channels[1]!.enqueue(frame('patch', { base: 4, seq: 5, stamp: stamp(3), patch: [] }));
    await waitFor(() => expect(tracker.error?.message).toContain('baseline mismatch'));
    expect(channels).toHaveLength(2); expect(holder.data).toBe(2);
    const malformed = feed();
    channels[2]!.enqueue(frame('value', { value: 3, stamp: stamp(0), seq: 1 }));
    await malformed.runtime.settle();
    channels[2]!.enqueue(frame('patch', { base: 1, seq: 2, stamp: stamp(1), patch: [{ op: 'remove', path: '/missing' }] }));
    await waitFor(() => expect(malformed.tracker.error?.message).toContain('Invalid live patch operations'));
    expect(malformed.holder.data).toBe(3); expect(channels).toHaveLength(3);
  });

  it('recovers a missing initial baseline but never accepts patches for generators', async () => {
    const live = feed();
    channels[0]!.enqueue(frame('patch', { base: 1, seq: 2, stamp: stamp(1), patch: [] }));
    await waitFor(() => expect(channels).toHaveLength(2));
    channels[1]!.enqueue(frame('value', { value: 2, stamp: stamp(2), seq: 1 }));
    await live.runtime.settle(); expect(live.holder.data).toBe(2);
    const generator = feed('generator');
    channels[2]!.enqueue(frame('value', { value: 3 }));
    await generator.runtime.settle();
    channels[2]!.enqueue(frame('patch', { base: 1, seq: 2, stamp: stamp(1), patch: [] }));
    await waitFor(() => expect(generator.tracker.error?.message).toContain('only supported for live queries'));
    expect(channels).toHaveLength(3);
  });

  it('negotiates patches only for live queries and accepts legacy full-value servers', async () => {
    const headers: Headers[] = [];
    const runtime = createDataRuntime({ baseURL: 'https://app.test', fetch: async (_url, init) => {
      headers.push(new Headers(init?.headers));
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { channels.push(controller); } }),
        { headers: { 'content-type': 'text/event-stream' } });
    } });
    runtimes.push(runtime);
    const live = runWithDataRuntime(runtime, () => createStreamingSource<number>('/live', {}, 'live')) as unknown as FetchResource<number>;
    runWithDataRuntime(runtime, () => createStreamingSource<number>('/generator', {}, 'generator'));
    expect(headers[0]!.get('x-mmd-live-patches')).toBe('1');
    expect(headers[1]!.has('x-mmd-live-patches')).toBe(false);
    channels[0]!.enqueue(frame('value', { value: 1, stamp: stamp(0) }));
    channels[0]!.enqueue(frame('value', { value: 2, stamp: stamp(1) }));
    channels[1]!.enqueue(frame('value', { value: 3 }));
    channels[1]!.enqueue(frame('done', { updates: [] }));
    await runtime.settle(); expect(live.data).toBe(2);
  });

  it('settles readiness at the first live value, updates repeatedly, and closes at final ownership release', async () => {
    const { runtime, holder, tracker, cancelled } = feed();
    channels[0]!.enqueue(frame('value', { value: 1, stamp: stamp(0) }));
    expect(await runtime.settle()).toBe(true);
    expect(holder.data).toBe(1);
    expect(tracker.streaming).toBe(true);
    channels[0]!.enqueue(frame('value', { value: 2, stamp: stamp(1) }));
    await waitFor(() => expect(holder.data).toBe(2));
    disposeFetchResource(holder);
    await waitFor(() => expect(cancelled()).toBe(1));
  });

  it('preserves a source while protected and allows a plain promise operation to release it', async () => {
    const { runtime, holder, source } = feed();
    channels[0]!.enqueue(frame('value', { value: 1, stamp: stamp(0) }));
    await runtime.settle();
    const release = protectLiveSources(source);
    holder.update(() => 10);
    channels[0]!.enqueue(frame('value', { value: 2, stamp: stamp(1) }));
    await Promise.resolve(); await Promise.resolve();
    expect(holder.data).toBe(10);
    release(Promise.resolve(1));
    await waitFor(() => expect(holder.data).toBe(2));
  });

  it('waits for generator completion before onSuccess and never retries an interrupted mutation', async () => {
    const { runtime, holder, tracker } = feed('generator');
    const successes: number[] = [];
    tracker.onSuccess(value => successes.push(value));
    channels[0]!.enqueue(frame('value', { value: 1 }));
    await runtime.settle();
    expect(successes).toEqual([]);
    channels[0]!.enqueue(frame('value', { value: 2 }));
    channels[0]!.enqueue(frame('done', { updates: [] }));
    await waitFor(() => expect(successes).toEqual([2]));
    expect(holder.data).toBe(2);
    expect(tracker.streaming).toBe(false);
    const interrupted = feed('generator');
    channels[1]!.enqueue(frame('value', { value: 3 }));
    await interrupted.runtime.settle();
    channels[1]!.close();
    await waitFor(() => expect(interrupted.tracker.error?.message).toContain('before completion'));
    expect(interrupted.holder.data).toBe(3);
    expect(channels).toHaveLength(2);
  });

  it('parses fragmented UTF-8 frames and rejects corrupt streams without losing prior data', async () => {
    const { runtime, holder, tracker } = feed('generator');
    const bytes = frame('value', { value: 'café 🪐' });
    for (let index = 0; index < bytes.length; index++) channels[0]!.enqueue(bytes.slice(index, index + 1));
    await runtime.settle();
    expect(holder.data as unknown).toBe('café 🪐');
    channels[0]!.enqueue(encoder.encode('event: value\ndata: broken\n\n'));
    await waitFor(() => expect(tracker.error).not.toBeNull());
    expect(holder.data as unknown).toBe('café 🪐');
  });

  it('keeps form submission pending through generator yields and settles only on completion', async () => {
    const { runtime, source } = feed('generator');
    const form = runWithDataRuntime(runtime, () => $forms(() => source));
    form.submit(new FormData());
    channels[0]!.enqueue(frame('value', {value:1}));
    await runtime.settle();
    expect(form.pending).toBe(true);
    channels[0]!.enqueue(frame('value', {value:2}));
    channels[0]!.enqueue(frame('done', {updates:[]}));
    await waitFor(() => expect(form.pending).toBe(false));
    expect(form.result).toBe(2);
    const failed = feed('generator');
    const failedForm = runWithDataRuntime(failed.runtime, () => $forms(() => failed.source));
    failedForm.submit(new FormData());
    channels[1]!.enqueue(frame('value', {value:3}));
    await failed.runtime.settle();
    channels[1]!.enqueue(frame('error', {message:'Generation failed'}));
    await waitFor(() => expect(failedForm.pending).toBe(false));
    expect(failedForm.errors[0]?.message).toContain('Generation failed');
  });

  it('rejects plain payloads rather than treating arrays as source holders', () => {
    expect(() => protectLiveSources([1, 2])).toThrow('live source');
  });

  it('limits individual UTF-8 frames, not batches of valid frames in one network chunk', async () => {
    const { runtime, holder, tracker } = feed('generator');
    const first = frame('value', { value: 'a'.repeat(600_000) });
    const second = frame('value', { value: 'b'.repeat(600_000) });
    const batch = new Uint8Array(first.length + second.length);
    batch.set(first); batch.set(second, first.length);
    channels[0]!.enqueue(batch);
    await runtime.settle();
    expect(holder.data as unknown).toBe('b'.repeat(600_000));
    expect(tracker.error).toBeNull();
    channels[0]!.enqueue(frame('value', { value: '🪐'.repeat(300_000) }));
    await waitFor(() => expect(tracker.error?.message).toContain('exceeds 1 MiB'));
    expect(holder.data as unknown).toBe('b'.repeat(600_000));
  });
});
