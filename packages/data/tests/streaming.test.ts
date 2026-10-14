import { afterEach, describe, expect, it } from 'bun:test';
import { $forms, createDataRuntime, runWithDataRuntime } from '../src/index';
import { createStreamingSource } from '../src/streaming';
import { trackResolvedValue } from '../src/transparent';
import { disposeFetchResource } from '../src/resource';
import { protectLiveSources } from '../src/source-protection';
import type { FetchResource } from '../src/types';
import { waitFor } from '../../../test-support/helpers';

const encoder = new TextEncoder();
const channels: ReadableStreamDefaultController<Uint8Array>[] = [];
const runtimes: ReturnType<typeof createDataRuntime>[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.clear(); channels.length = 0; });
function frame(event: string, data: unknown) { return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function feed(mode: 'live' | 'generator' = 'live') {
  let cancelled = 0;
  const runtime = createDataRuntime({ baseURL: 'https://app.test', fetch: async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { channels.push(controller); }, cancel() { cancelled++; },
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  runtimes.push(runtime);
  const source = runWithDataRuntime(runtime, () => createStreamingSource<number>('/value', {}, mode));
  const holder = source as unknown as FetchResource<number>;
  const tracker = trackResolvedValue(source);
  return { runtime, holder, source, tracker, cancelled: () => cancelled };
}
const stamp = (revision: number, key = 'notes') => ({ epoch: 'test', key, revision });

describe('compiler-owned streaming sources', () => {
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
