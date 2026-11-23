import { describe, expect, it, vi } from 'bun:test';
import { createServerFunctionRoutes, createServerRouter } from '../src/http-router';
import { liveHub } from '../src/live';

const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
const decode = (chunk: ReadableStreamReadResult<Uint8Array>) => new TextDecoder().decode(chunk.value);

/** Open a direct live stream and collect its frames, leaving out heartbeats. */
async function open(router: ReturnType<typeof createServerRouter>) {
  const response = await router.fetch(new Request('https://app.test/_fn/payment', { headers: { 'x-mmd-stream': 'live' } }));
  const reader = response.body!.getReader();
  const frames: string[] = [];
  void (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      const text = decode(chunk);
      if (!text.startsWith(':')) frames.push(text);
    }
  })();
  return { reader, frames };
}

describe('live refresh callback', () => {
  it('picks the next check from each result, pauses with false, and resumes after an invalidation', async () => {
    vi.useFakeTimers();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      let state = 'pending', checks = 0;
      const services = {};
      const router = createServerRouter({ services, routes: createServerFunctionRoutes([{
        id: 'payment', path: '/_fn/payment', method: 'GET', parameters: [], live: () => ['payment'],
        refresh: (payment: unknown) => {
          const current = (payment as { state: string }).state;
          if (current === 'pending') return '5s';
          if (current === 'failed') return '1m'; // a late payment can still arrive
          return false; // final
        },
        handler() { checks++; return { state }; },
      }]) });
      const stream = await open(router);
      reader = stream.reader;
      const after = async (milliseconds: number) => { vi.advanceTimersByTime(milliseconds); await flush(); };

      await flush();
      expect(stream.frames).toHaveLength(1);
      expect(checks).toBe(1);

      // Pending: every 5 seconds. An unchanged answer sends nothing.
      await after(4_999); expect(checks).toBe(1);
      await after(1); expect(checks).toBe(2); expect(stream.frames).toHaveLength(1);

      // Failed: the reader gets it, and checks slow to a minute.
      state = 'failed';
      await after(5_000); expect(checks).toBe(3); expect(stream.frames.at(-1)).toContain('"failed"');
      await after(59_999); expect(checks).toBe(3);
      await after(1); expect(checks).toBe(4);

      // Final: no more checks, however long it stays open.
      state = 'succeeded';
      await after(60_000); expect(checks).toBe(5); expect(stream.frames.at(-1)).toContain('"succeeded"');
      await after(3_600_000); expect(checks).toBe(5);

      // A change told by the app (a webhook, an updates key) still arrives, and its result
      // decides again: pending, so checks resume.
      state = 'pending';
      liveHub(services).invalidate(['payment']); await flush();
      expect(checks).toBe(6); expect(stream.frames.at(-1)).toContain('"pending"');
      await after(5_000); expect(checks).toBe(7);

      await reader.cancel(); await flush();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await reader?.cancel();
      vi.useRealTimers();
    }
  });

  it('fails the read when the callback returns something that is not a duration or false', async () => {
    const reports: unknown[] = [];
    const router = createServerRouter({
      onError(failure) { reports.push(failure); return new Response('private', { status: 500 }); },
      routes: createServerFunctionRoutes([{
        id: 'payment', path: '/_fn/payment', method: 'GET', parameters: [], live: () => ['payment'],
        refresh: () => 'soon', handler: () => ({ state: 'pending' }),
      }]),
    });
    const stream = await open(router);
    try {
      await waitForFrame(stream.frames);
      expect(stream.frames[0]).toStartWith('event: error');
      expect(stream.frames[0]).toContain('Live query failed');
      expect(String(reports[0])).toContain("refresh takes a duration like '30s' or '5m'");
    } finally {
      await stream.reader.cancel();
    }
  });
});

async function waitForFrame(frames: string[]) {
  for (let attempt = 0; attempt < 100 && frames.length === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
}
