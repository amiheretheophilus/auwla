import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { browserExecutable, closeBrowser } from '../../../../test-support/browser';
import { waitFor } from '../../../../test-support/helpers';
import { memoizedDom } from '../project/bun';
import { parseArguments, run } from '../project/cli';
import { hostEntryModule, standaloneDeliveryModule } from './delivery';

const root = mkdtempSync(join(import.meta.dir, '../../.websocket-test-'));
const sockets = new Set<WebSocket>();
const cleanups: Array<() => void | Promise<void>> = [];

afterAll(async () => {
  for (const socket of sockets) socket.close();
  for (const cleanup of cleanups) await cleanup();
  rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), text);
}

write('index.html', '<!DOCTYPE html><div id="root"><!--ssr-outlet--></div><script type="module" src="./main.ts"></script>');
write('main.ts', `
import { openRoom } from '#server-functions';
import { $track } from '@memoized-dom/data';
globalThis.openRoom = openRoom;
globalThis.trackRoom = $track;
`);
write('server.ts', `
import { serve } from '@memoized-dom/server';
import { define } from './server/define';
import { App } from './App';
const app = serve({ define });
app.ssr(App);
export default Object.assign(app, { port: 0 });
`);
write('App.tsx', `export function App() { return <main>Socket fixture</main>; }`);
write('server/define.ts', `
import { createDefine } from '@memoized-dom/server';
export const define = createDefine();
`);
write('server/functions/_middleware.ts', `
export const middleware = [async (context, next) => {
  const cookie = context.request.headers.get('cookie');
  const viewer = context.request.headers.get('x-viewer') ?? cookie?.match(/(?:^|; )viewer=([^;]+)/)?.[1];
  if (!viewer) return new Response('Viewer required', { status: 401 });
  context.state.viewer = viewer;
  return next();
}];
`);
write('server/functions/rooms.ts', `
import { replyToSocket } from '@memoized-dom/server';
import { define } from '../define';

const boards = new Map();
export const openRoom = define.function({
  live: (_context, room) => ['board', room],
  websocket(context, room: string, options = { prefix: '' }) {
    const viewer = context.state.viewer;
    let serializations = 0;
    return {
      initial: () => ({ count: boards.get(room) ?? 0, viewer }),
      async message(delta: number) {
        if (delta <= 0) return replyToSocket('DENIED_BY_ROOM');
        if (room === 'serialized-result') {
          return { toJSON(key: string) { return { key, count: ++serializations }; } };
        }
        const count = (boards.get(room) ?? 0) + delta;
        boards.set(room, count);
        const update = { count, viewer: options.prefix + viewer };
        return room === 'slow-reader' ? { ...update, padding: 'x'.repeat(512 * 1024) } : update;
      },
      close() {
        return { viewer, departed: true };
      },
    };
  },
});
`);

const endpoint = '/_fn/rooms/openRoom';

function endpointURL(origin: URL, room: string, prefix?: string): URL {
  const url = new URL(endpoint, origin);
  url.searchParams.set('args', JSON.stringify({ room, options: prefix === undefined ? undefined : { prefix } }));
  return url;
}

function wire(origin: URL, room: string, viewer: string, prefix?: string) {
  const url = endpointURL(origin, room, prefix);
  url.protocol = 'ws:';
  const socket = new WebSocket(url, { headers: { 'x-viewer': viewer } });
  sockets.add(socket);
  const frames: unknown[] = [];
  let available = Promise.withResolvers<void>();
  let closed: Error | undefined;
  socket.addEventListener('message', event => {
    frames.push(JSON.parse(String(event.data)));
    available.resolve();
  });
  socket.addEventListener('close', event => {
    sockets.delete(socket);
    closed = new Error(`The test socket closed (${event.code}): ${event.reason}`);
    available.resolve();
  });
  return {
    socket,
    async next(): Promise<unknown> {
      if (frames.length === 0 && closed === undefined) await available.promise;
      if (frames.length === 0) throw closed;
      const frame = frames.shift();
      if (frames.length === 0) available = Promise.withResolvers<void>();
      return frame;
    },
    send(id: number, value: number): void {
      socket.send(JSON.stringify({ id, value }));
    },
    close: () => socket.close(),
  };
}

async function assertRoomDelivery(origin: URL, peerOrigin = origin): Promise<void> {
  const denied = await fetch(endpointURL(origin, 'alpha'));
  expect(denied.status).toBe(401);
  const ordinary = await fetch(endpointURL(origin, 'alpha'), { headers: { 'x-viewer': 'Ada' } });
  expect(ordinary.status).toBe(426);

  const a = wire(origin, 'alpha', 'Ada', 'Dr ');
  const b = wire(peerOrigin, 'alpha', 'Ben');
  const c = wire(origin, 'another-room', 'Cyd');
  try {
    expect(await a.next()).toEqual({ type: 'ready', value: { count: 0, viewer: 'Ada' } });
    expect(await b.next()).toEqual({ type: 'ready', value: { count: 0, viewer: 'Ben' } });
    expect(await c.next()).toEqual({ type: 'ready', value: { count: 0, viewer: 'Cyd' } });

    a.send(1, -1);
    expect(await a.next()).toEqual({ type: 'result', id: 1, value: 'DENIED_BY_ROOM' });

    a.send(2, 3);
    const edit = { count: 3, viewer: 'Dr Ada' };
    expect(await a.next()).toEqual({ type: 'message', value: edit });
    expect(await a.next()).toEqual({ type: 'result', id: 2, value: edit });
    expect(await b.next()).toEqual({ type: 'message', value: edit });

    c.send(3, 1);
    expect(await c.next()).toEqual({ type: 'message', value: { count: 1, viewer: 'Cyd' } });

    const late = wire(origin, 'alpha', 'Dee');
    try {
      expect(await late.next()).toEqual({ type: 'ready', value: { count: 3, viewer: 'Dee' } });
    } finally {
      late.close();
    }
    expect(await b.next()).toEqual({ type: 'message', value: { viewer: 'Dee', departed: true } });
  } finally {
    a.close();
    b.close();
    c.close();
  }
}

async function build(runtime: 'bun' | 'cloudflare'): Promise<string> {
  const out = `out-${runtime}`;
  const command = parseArguments([
    'build', 'main.ts', '--server', 'server.ts', '--server-folder', 'server', '--runtime', runtime, '--out', out,
  ], root);
  if (typeof command === 'string') throw new Error(command);
  const lines: string[] = [];
  const status = await run(command, line => lines.push(line));
  expect(status, lines.join('\n')).toBe(0);
  return join(root, out);
}

describe('WebSocket server functions', () => {
  const bunHost = async () => {
    const out = await build('bun');
    const app = (await import(pathToFileURL(join(out, 'server.js')).href)).default;
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch, websocket: app.websocket });
    cleanups.push(() => server.stop(true));
    return { server, app };
  };

  test('Bun upgrades through middleware and broadcasts by room across its listeners', async () => {
    const { server, app } = await bunHost();
    const second = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch, websocket: app.websocket });
    cleanups.push(() => second.stop(true));
    // A header alone cannot turn an HTTP request into a WebSocket session.
    const response = await app.fetch(new Request(endpointURL(server.url, 'alpha'), {
      headers: { 'x-viewer': 'Ada', upgrade: 'websocket' },
    }));
    expect(response.status).toBe(426);
    const crossOrigin = await fetch(endpointURL(server.url, 'alpha'), {
      headers: { 'x-viewer': 'Ada', upgrade: 'websocket', origin: 'https://other.example' },
    });
    expect(crossOrigin.status).toBe(403);
    await assertRoomDelivery(server.url, second.url);
  }, 20_000);

  test('Bun closes a peer that cannot drain room broadcasts while the sender stays connected', async () => {
    const { server } = await bunHost();
    const slow = wire(server.url, 'slow-reader', 'Slow');
    const writer = wire(server.url, 'slow-reader', 'Writer');
    try {
      await slow.next();
      await writer.next();
      slow.socket.pause();

      for (let id = 1; id <= 32 && server.pendingWebSockets === 2; id++) {
        writer.send(id, 1);
        // The slow peer can depart concurrently with the sender's response.
        for (;;) {
          const frame = await writer.next();
          if (typeof frame === 'object' && frame !== null && 'type' in frame && frame.type === 'result') break;
        }
      }

      await waitFor(() => expect(server.pendingWebSockets).toBe(1));
      expect(writer.socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      slow.socket.terminate();
      writer.close();
    }
  }, 20_000);

  test('the broadcast and acknowledgement share one serialization of the handler result', async () => {
    const { server } = await bunHost();
    const sender = wire(server.url, 'serialized-result', 'Sender');
    const observer = wire(server.url, 'serialized-result', 'Observer');
    try {
      await sender.next();
      await observer.next();
      sender.send(1, 1);

      const value = { key: 'value', count: 1 };
      const frame = { type: 'message', value };
      expect(await sender.next()).toEqual(frame);
      expect(await sender.next()).toEqual({ type: 'result', id: 1, value });
      expect(await observer.next()).toEqual(frame);
    } finally {
      sender.close();
      observer.close();
    }
  }, 20_000);

  test('Node generated host passes upgrades to the installed adapter', async () => {
    write('node-host.ts', hostEntryModule('node', './server.ts'));
    const output = await Bun.build({
      entrypoints: [join(root, 'node-host.ts')],
      target: 'node',
      format: 'esm',
      outdir: join(root, 'out-node'),
      plugins: [memoizedDom({
        client: './main.ts', server: { entry: './server.ts', folder: './server', runtime: 'node' },
        delivery: standaloneDeliveryModule(), target: 'server', root,
      })],
    });
    expect(output.success).toBe(true);
    const child = Bun.spawn(['node', output.outputs[0]!.path], { stdout: 'pipe', stderr: 'inherit' });
    cleanups.push(async () => { child.kill(); await child.exited; });
    const reader = child.stdout.getReader();
    let line = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Node exited before listening');
        line += new TextDecoder().decode(chunk.value);
        const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(line)?.[0];
        if (origin !== undefined) {
          await assertRoomDelivery(new URL(origin));
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }, 20_000);

  test('Cloudflare CLI config starts a Durable Object and delivers room updates in workerd', async () => {
    const out = await build('cloudflare');
    const config = JSON.parse(readFileSync(join(out, 'wrangler.json'), 'utf8'));
    const binding = config.durable_objects.bindings[0];
    expect(config.migrations[0].new_sqlite_classes).toEqual([binding.class_name]);
    const worker = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      scriptPath: join(out, 'worker.js'),
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      durableObjects: { [binding.name]: { className: binding.class_name, useSQLite: true } },
    }));
    cleanups.push(() => worker.dispose());
    await assertRoomDelivery(await worker.ready);
  }, 25_000);

  const chrome = browserExecutable();

  test.skipIf(chrome === null)('browser facade tracks state, correlates replies and rereads after reconnect', async () => {
    const { server, app } = await bunHost();
    const browser = await puppeteer.launch({ executablePath: chrome!, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto(server.url.href);
      await page.waitForFunction('typeof globalThis.openRoom === "function"');
      const initial = await page.evaluate(`(async () => {
        document.cookie = 'viewer=Browser';
        globalThis.room = openRoom('browser');
        globalThis.events = [];
        room.onMessage(value => events.push(value));
        const connecting = trackRoom(room).status;
        const snapshot = await room.ready;
        const privateResult = await room.send(0);
        const edit = await room.send(7);
        return { connecting, open: trackRoom(room).status, snapshot, privateResult, edit, events };
      })()`);
      const snapshot = { count: 0, viewer: 'Browser' };
      const edit = { count: 7, viewer: 'Browser' };
      expect(initial).toEqual({ connecting: 'connecting', open: 'open', snapshot, privateResult: 'DENIED_BY_ROOM', edit, events: [snapshot, edit] });

      await app.closeSockets();
      await page.waitForFunction('events.length === 3 && trackRoom(room).status === "open"');
      expect(await page.evaluate('events[2]')).toEqual(edit);
      expect(await page.evaluate('room.close(); trackRoom(room).status')).toBe('closed');
    } finally {
      await closeBrowser(browser);
    }
  }, 25_000);
});
