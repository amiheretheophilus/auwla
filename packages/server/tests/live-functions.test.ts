import { describe, expect, it } from 'bun:test';
import { createDefine, serve } from '../src/index';
import { createServerFunctionRoutes, type ServerFunctionRouteDefinition } from '../src/http-router';
import { LiveHub, liveResponse } from '../src/live';

const decoder = new TextDecoder();
const url = 'https://app.test/_fn/notes/getNotes?id=one';
function request(user = 'Ada') {
  return new Request(url, { headers: { 'x-mmd-stream': 'live', 'x-user': user } });
}
async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const next = await reader.read();
  if (next.done) throw new Error('Unexpected stream completion');
  const text = decoder.decode(next.value);
  return { event: text.split('\n')[0]!.slice(7), data: JSON.parse(text.split('\n')[1]!.slice(6)) as { value: unknown; stamp: { revision: number }; updates?: unknown[] } };
}
function install(app: object, routes: readonly unknown[]) {
  (app as { installServerFunctions(routes: readonly unknown[]): void }).installServerFunctions(routes);
}

describe('automatic live server functions', () => {
  it('streams invalidations under each subscriber context and acknowledges mutations', async () => {
    const define = createDefine<{ user: string }, unknown, { rows: { value: number } }>();
    define.service('rows', () => ({ value: 0 }));
    const app = serve({ define, state: req => ({ user: req.headers.get('x-user') ?? '' }) });
    let queries = 0;
    app.use(({ state }, next) => state.user ? next() : new Response(null, { status: 401 }));
    const definitions: ServerFunctionRouteDefinition<{ user: string }, unknown, { rows: { value: number } }>[] = [
      { id: 'get', method: 'GET', path: '/_fn/notes/getNotes', parameters: [{ name: 'id', optional: false, queryKind: 'string' }],
        live: (_context, id) => ['notes', String(id)],
        async handler({ state, services }) { queries++; return { owner: state.user, value: services.rows.value }; } },
      { id: 'post', method: 'POST', path: '/_fn/notes/postNote', parameters: [],
        updates: () => ['notes', 'one'],
        async handler({ services }) { return { value: ++services.rows.value }; } },
    ];
    install(app, createServerFunctionRoutes(definitions));
    expect((await app.fetch(new Request(url, { headers: { 'x-mmd-stream': 'live' } }))).status).toBe(401);
    const ada = (await app.fetch(request())).body!.getReader();
    const grace = (await app.fetch(request('Grace'))).body!.getReader();
    expect((await read(ada)).data.value).toEqual({ owner: 'Ada', value: 0 });
    expect((await read(grace)).data.value).toEqual({ owner: 'Grace', value: 0 });
    const posted = await app.fetch(new Request('https://app.test/_fn/notes/postNote', { method: 'POST', headers: { 'x-user': 'Writer' } }));
    expect(await posted.json()).toEqual({ value: 1 });
    expect(JSON.parse(posted.headers.get('x-mmd-updates')!)[0].revision).toBe(1);
    const updated = await read(ada);
    expect(updated.data.value).toEqual({ owner: 'Ada', value: 1 });
    expect(updated.data.stamp.revision).toBe(1);
    expect((await read(grace)).data.value).toEqual({ owner: 'Grace', value: 1 });
    expect(queries).toBe(4);
    define.invalidate(['notes', 'one']);
    expect((await read(ada)).data.stamp.revision).toBe(2);
    await ada.cancel(); await grace.cancel();
  });

  it('coalesces invalidations and never labels an older in-flight value with a newer cursor', async () => {
    const hub = new LiveHub();
    const key = hub.key(['notes', 'one']);
    let value = 0, calls = 0;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const reader = liveResponse(hub, key, request(), async () => {
      const captured = value;
      if (++calls === 1) await gate;
      return captured;
    }).body!.getReader();
    const pending = read(reader);
    await Promise.resolve();
    value = 1; hub.invalidate(['notes', 'one']);
    value = 2; hub.invalidate(['notes', 'one']);
    finish();
    const snapshot = await pending;
    expect(snapshot.data.value).toBe(2);
    expect(snapshot.data.stamp.revision).toBe(2);
    expect(calls).toBe(2);
    await reader.cancel();
  });

  it('does not notify on errors and evaluates updates from validated server input', async () => {
    const define = createDefine();
    const app = serve({ define });
    const routes = createServerFunctionRoutes([
      { id: 'get', method: 'GET', path: '/_fn/live/get', parameters: [], live: () => ['value', 42], handler: async () => 1 },
      { id: 'save', method: 'POST', path: '/_fn/live/save', schemaInput: true, parameters: [{ name: 'input', optional: false }],
        input: { '~standard': { vendor: 'test', version: 1, validate: value => ({ value: Number(value) }) } },
        updates: (_context, input) => ['value', Number(input)], handler: async () => 'saved' },
      { id: 'fail', method: 'POST', path: '/_fn/live/fail', parameters: [], updates: () => ['value', 42], handler: async () => new Response(null, { status: 400 }) },
    ]);
    install(app, routes);
    const reader = (await app.fetch(new Request('https://app.test/_fn/live/get', { headers: { 'x-mmd-stream': 'live' } }))).body!.getReader();
    expect((await read(reader)).data.stamp.revision).toBe(0);
    expect((await app.fetch(new Request('https://app.test/_fn/live/fail', { method: 'POST' }))).headers.has('x-mmd-updates')).toBe(false);
    const saved = await app.fetch(new Request('https://app.test/_fn/live/save', { method: 'POST', body: JSON.stringify('42') }));
    expect(JSON.parse(saved.headers.get('x-mmd-updates')!)[0].key).toBe('["value",42]');
    expect((await read(reader)).data.stamp.revision).toBe(1);
    await reader.cancel();
  });

  it('keeps server snapshots finite, and streams generator values with explicit completion', async () => {
    const app = serve({ define: createDefine() });
    let returned = 0;
    install(app, createServerFunctionRoutes([
      { id: 'live', method: 'GET', path: '/_fn/live/get', parameters: [], live: () => ['notes'], handler: async () => ['initial'] },
      { id: 'generator', method: 'POST', path: '/_fn/live/answer', parameters: [],
        async *handler() { yield 'a'; yield 'ab'; return 'not another payload'; } },
      { id: 'first', method: 'GET', path: '/_fn/live/first', parameters: [],
        async *handler({ request }) { try { yield 1; await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true })); } finally { returned++; } } },
    ]));
    const initial = await app.fetch(new Request('https://app.test/_fn/live/get', { headers: { 'x-mmd-stream': 'snapshot' } }));
    expect(await initial.json()).toEqual(['initial']);
    expect(initial.headers.has('x-mmd-live')).toBe(true);
    const first = await app.fetch(new Request('https://app.test/_fn/live/first', { headers: { 'x-mmd-stream': 'snapshot' } }));
    expect(await first.json()).toBe(1);
    await Promise.resolve();
    expect(returned).toBe(1);
    const reader = (await app.fetch(new Request('https://app.test/_fn/live/answer', { method: 'POST', headers: { 'x-mmd-stream': 'generator' } }))).body!.getReader();
    expect((await read(reader)).data.value).toBe('a');
    expect((await read(reader)).data.value).toBe('ab');
    expect((await read(reader)).event).toBe('done');
    expect((await reader.read()).done).toBe(true);
    expect((await app.fetch(new Request('https://app.test/_fn/live/answer', { method: 'POST' }))).status).toBe(400);
  });

  it('cancels pending live queries on body cancellation', async () => {
    const hub = new LiveHub();
    let aborted = false;
    const reader = liveResponse(hub, hub.key(['notes']), request(), signal => new Promise(resolve => {
      signal.addEventListener('abort', () => { aborted = true; resolve(null); }, { once: true });
    })).body!.getReader();
    const pending = reader.read();
    await Promise.resolve();
    await reader.cancel();
    await pending;
    expect(aborted).toBe(true);
    expect(() => hub.key([])).toThrow();
    expect(() => hub.key([NaN])).toThrow();
  });
});
