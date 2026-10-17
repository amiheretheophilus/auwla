import { describe, expect, it, vi } from 'bun:test';
import { createDefine, serve } from '../src/index';
import { createServerFunctionRoutes, createServerRouter } from '../src/http-router';
import { liveHub, type LiveHub } from '../src/live';

const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
const decode = (chunk: ReadableStreamReadResult<Uint8Array>) => new TextDecoder().decode(chunk.value);

describe('live heartbeat policy', () => {
  for (const multiplex of [false, true]) {
    it.each([undefined, 30_000])(`uses an idle timer without polling or per-subscription pings (multiplex=${multiplex}, interval=%s)`, async configured => {
      vi.useFakeTimers();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let hub: LiveHub | undefined;
      let calls = 0, value = 0;
      try {
        // Generated routes can be loaded from a different server module copy.
        const makeRoutes = configured === undefined ? createServerFunctionRoutes
          : (await import('../src/http-router.ts?heartbeat-route-copy')).createServerFunctionRoutes;
        const app = serve({ define: createDefine(), liveHeartbeatInterval: configured });
        (app as unknown as { installServerFunctions: (routes: ReturnType<typeof createServerFunctionRoutes>) => void })
          .installServerFunctions(makeRoutes([{
            id: 'heartbeat', path: '/_fn/heartbeat', method: 'GET', parameters: [], live: () => ['heartbeat'],
            handler({ services }) { hub = liveHub(services); calls++; return value; },
          }]));
        const response = await app.fetch(multiplex
          ? new Request('https://app.test/_memoized/live', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-mmd-multiplex': '1' },
            body: JSON.stringify({ version: 1, revision: 1, unsubscribe: [],
              subscribe: ['one', 'two'].map(id => ({ id, url: '/_fn/heartbeat', page: false })) }),
          })
          : new Request('https://app.test/_fn/heartbeat', { headers: { 'x-mmd-stream': 'live' } }));
        reader = response.body!.getReader();
        const subscriptions = multiplex ? 2 : 1;
        if (multiplex) expect(decode(await reader.read())).toStartWith('event: session');
        for (let index = 0; index < subscriptions; index++) expect(decode(await reader.read())).toStartWith('event: value');
        await flush();
        expect(calls).toBe(subscriptions);
        expect(vi.getTimerCount()).toBe(1);

        const interval = configured ?? 15_000;
        let received = false;
        const firstHeartbeat = reader.read().then(chunk => { received = true; return decode(chunk); });
        vi.advanceTimersByTime(interval - 1); await flush();
        expect(received).toBe(false);
        vi.advanceTimersByTime(1); await flush();
        expect(await firstHeartbeat).toBe(': heartbeat\n\n');
        expect(calls).toBe(subscriptions);

        // Real data interrupts the idle wait and starts a full new interval.
        vi.advanceTimersByTime(interval - 1); await flush();
        value = 1; hub!.invalidate(['heartbeat']);
        for (let index = 0; index < subscriptions; index++) expect(decode(await reader.read())).toContain('"value":1');
        await flush();
        received = false;
        const nextHeartbeat = reader.read().then(chunk => { received = true; return decode(chunk); });
        vi.advanceTimersByTime(interval - 1); await flush();
        expect(received).toBe(false);
        vi.advanceTimersByTime(1); await flush();
        expect(await nextHeartbeat).toBe(': heartbeat\n\n');
        expect(calls).toBe(subscriptions * 2);
        expect(vi.getTimerCount()).toBe(1);
      } finally {
        try {
          await reader?.cancel(); await flush();
          expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
      }
    });
  }

  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])('rejects invalid intervals at configuration time: %s', value => {
    expect(() => serve({ define: createDefine(), liveHeartbeatInterval: value })).toThrow('liveHeartbeatInterval');
    expect(() => createServerRouter({ routes: [], liveHeartbeatInterval: value })).toThrow('liveHeartbeatInterval');
  });
});
