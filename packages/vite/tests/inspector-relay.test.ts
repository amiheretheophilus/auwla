import { expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ViteDevServer } from 'vite';
import { diagnostic } from '@memoized-dom/devtools';
import { configureInspector } from '../src/inspector';
import type { FullstackPluginApi } from '../src/fullstack';

function fixture() {
  const bus = new EventEmitter(), socket = Object.assign(new EventEmitter(), { bufferedAmount: 0 });
  const sent: unknown[] = [];
  const client = { socket, send(data: unknown) { sent.push(data); } };
  let closed = 0;
  const server = { ws: bus, async close() { closed++; } } as unknown as ViteDevServer;
  const api = { nativeDevelopment: true, runtime: 'bun' } as FullstackPluginApi;
  configureInspector(server, api);
  return { server, api, bus, socket, sent, open: () => bus.emit('memoized-dom:inspector:open', {}, client),
    close: () => bus.emit('memoized-dom:inspector:close', {}, client), closed: () => closed };
}
it('relays sanitized metadata only to opened clients of the owning Vite project and releases listeners', async () => {
  const a = fixture(), b = fixture();
  const event = diagnostic('live', 'query-started', { source: 'getNotes', body: 'secret' }, 'server')!;
  a.api.diagnosticSink!(event); expect(a.sent).toHaveLength(0);
  a.open(); b.open(); expect(a.sent).toHaveLength(1);
  a.api.diagnosticSink!({ ...event, data: { ...event.data, body: 'secret' } });
  expect(a.sent).toHaveLength(2); expect(b.sent).toHaveLength(1); expect(JSON.stringify(a.sent)).not.toContain('secret');
  a.close(); a.api.diagnosticSink!(event); expect(a.sent).toHaveLength(2);
  expect(a.socket.listenerCount('close')).toBe(0);
  await a.server.close(); await b.server.close();
  expect(a.api.diagnosticSink).toBeUndefined(); expect(a.bus.listenerCount('memoized-dom:inspector:open')).toBe(0); expect(a.closed()).toBe(1);
});
it('detaches slow or disconnected inspectors without closing the application HMR socket', async () => {
  const fixtureA = fixture(); fixtureA.open();
  fixtureA.socket.bufferedAmount = 600_000;
  fixtureA.api.diagnosticSink!(diagnostic('live', 'query-started', { source: 'getNotes' }, 'server')!);
  expect(fixtureA.sent).toHaveLength(1); expect(fixtureA.socket.listenerCount('close')).toBe(0);
  fixtureA.socket.bufferedAmount = 0; fixtureA.open(); expect(fixtureA.sent).toHaveLength(2);
  fixtureA.socket.emit('close'); fixtureA.api.diagnosticSink!(diagnostic('live', 'query-started', {}, 'server')!);
  expect(fixtureA.sent).toHaveLength(2); await fixtureA.server.close();
});
