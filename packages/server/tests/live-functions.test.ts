import { describe, expect, it, spyOn } from 'bun:test';
import { createDefine, serve } from '../src/index';
import { createServerFunctionRoutes, type ServerFunctionRouteDefinition } from '../src/http-router';
import { LiveHub, liveResponse } from '../src/live';
import { waitFor } from '../../../test-support/helpers';
import { applyLivePatch, type LiveJsonValue } from '@memoized-dom/data/internal';

const decoder = new TextDecoder();
const url = 'https://app.test/_fn/notes/getNotes?id=one';
function request(user = 'Ada') {
  return new Request(url, { headers: { 'x-mmd-stream': 'live', 'x-user': user } });
}
async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const next = await reader.read();
  if (next.done) throw new Error('Unexpected stream completion');
  const text = decoder.decode(next.value);
  return { event: text.split('\n')[0]!.slice(7), data: JSON.parse(text.split('\n')[1]!.slice(6)) as { value: unknown; stamp: { revision: number }; updates?: unknown[]; seq?: number; base?: number; patch?: unknown } };
}
function install(app: object, routes: readonly unknown[]) {
  (app as { installServerFunctions(routes: readonly unknown[]): void }).installServerFunctions(routes);
}

describe('automatic live server functions', () => {
  it('negotiates v2 page text edits and starts reconnects with complete current HTML', async () => {
    const hub = new LiveHub(), key = hub.key(['board']);
    let count = 0;
    const query = async () => ({ $mmd: 'page', version: 1, id: 'board',
      html: `<section>${'Static content'.repeat(100)}<p>${count}</p></section>`,
      binding: { key: 'contract', inputs: [count] },
    });
    const negotiated = () => new Request(url, { headers: { 'x-mmd-stream': 'live', 'x-mmd-live-patches': '2' } });
    const reader = liveResponse(hub, key, negotiated(), query).body!.getReader();
    try {
      const first = await read(reader); expect(first.event).toBe('value');
      count++; hub.invalidate(['board']);
      const next = await read(reader); expect(next.event).toBe('patch');
      expect(next.data.patch).toContainEqual(expect.objectContaining({ op: 'text', path: '/html' }));
      expect(applyLivePatch(first.data.value as LiveJsonValue, next.data.patch)).toEqual(await query());
      const reconnect = liveResponse(hub, key, negotiated(), query).body!.getReader();
      try {
        const restored = await read(reconnect);
        expect(restored.event).toBe('value'); expect(restored.data.seq).toBe(1);
        expect(restored.data.value).toEqual(await query());
      } finally { await reconnect.cancel(); }
    } finally { await reader.cancel(); }
  });

  it.each([false, true])('reports live query failures through onError with subscriber context (after initial value: %s)', async afterInitial => {
    const define = createDefine<{ user: string }, unknown, { secret: string }>();
    define.service('secret', () => 'private-service');
    const failure = new Error('private database details');
    const reports: { error: unknown; user: string; secret: string; path: string }[] = [];
    let cancelledReports = 0, fail = !afterInitial;
    const app = serve({ define, state: req => ({ user: req.headers.get('x-user')! }),
      async onError(error, context) {
        reports.push({ error, user: context.state.user, secret: context.services.secret, path: context.url.pathname });
        return new Response(new ReadableStream({ cancel() { cancelledReports++; } }), { status: 503 });
      },
    });
    install(app, createServerFunctionRoutes<{ user: string }, unknown, { secret: string }>([
      { id: 'get', method: 'GET', path: '/_fn/notes/getNotes', parameters: [{ name: 'id', optional: false, queryKind: 'string' }], live: () => ['notes'],
        async handler({ state }) { if (fail) throw failure; return state.user; } },
    ]));
    const response = await app.fetch(request('Ada'));
    const reader = response.body!.getReader();
    try {
      if (afterInitial) {
        expect((await read(reader)).data.value).toBe('Ada');
        fail = true; define.invalidate(['notes']);
      }
      const event = await read(reader);
      expect(event).toEqual({ event: 'error', data: { message: 'Live query failed' } });
      expect(JSON.stringify(event)).not.toContain(failure.message);
      expect(reports).toEqual([{ error: failure, user: 'Ada', secret: 'private-service', path: '/_fn/notes/getNotes' }]);
      await waitFor(() => expect(cancelledReports).toBe(1)); expect(response.status).toBe(200);
      expect((await reader.read()).done).toBe(true);
    } finally { await reader.cancel(); }
  });

  it('reports generator failures once without leaking exceptions or acknowledging failed mutations', async () => {
    const failure = new Error('private generator error');
    const reports: unknown[] = [];
    const app = serve({ define: createDefine(), onError(error, context) {
      reports.push([error, context.request.method, context.url.pathname]);
      return new Response('Not sent to the browser', { status: 500 });
    } });
    install(app, createServerFunctionRoutes([
      { id: 'answer', method: 'POST', path: '/_fn/notes/answer', parameters: [], updates: () => ['notes'],
        async *handler() { yield 'first'; throw failure; } },
    ]));
    const response = await app.fetch(new Request('https://app.test/_fn/notes/answer', {
      method: 'POST', headers: { 'x-mmd-stream': 'generator' },
    }));
    const reader = response.body!.getReader();
    try {
      expect((await read(reader)).data.value).toBe('first');
      expect(await read(reader)).toEqual({ event: 'error', data: { message: 'Streaming function failed' } });
      expect(reports).toEqual([[failure, 'POST', '/_fn/notes/answer']]);
      expect((await reader.read()).done).toBe(true);
      expect(response.headers.has('x-mmd-updates')).toBe(false);
    } finally { await reader.cancel(); }
  });

  it('logs unhandled stream failures and reporter failures, but not ordinary cancellation', async () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const hub = new LiveHub(), failure = new Error('private failure');
    try {
      const reader = liveResponse(hub, hub.key(['notes']), request(), async () => { throw failure; }).body!.getReader();
      expect((await read(reader)).event).toBe('error'); await reader.cancel();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('/_fn/notes/getNotes'), failure);
      logged.mockClear();
      const broken = liveResponse(hub, hub.key(['notes']), request(), async () => { throw failure; }, async () => { throw new Error('logger unavailable'); }).body!.getReader();
      expect((await read(broken)).event).toBe('error'); await broken.cancel();
      await waitFor(() => expect(logged).toHaveBeenCalledTimes(2));
      logged.mockClear();
      const cancelled = liveResponse(hub, hub.key(['notes']), request(), signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })).body!.getReader();
      const reading = cancelled.read(); await Promise.resolve(); await cancelled.cancel(); await reading;
      expect(logged).not.toHaveBeenCalled();
    } finally { logged.mockRestore(); }
  });

  it('releases a failed live subscription even while its asynchronous error reporter is pending', async () => {
    const hub = new LiveHub();
    const activity: boolean[] = []; hub.onActivity = active => activity.push(active);
    const reporting = Promise.withResolvers<void>();
    let reported = false;
    const reader = liveResponse(hub, hub.key(['notes']), request(), async () => { throw new Error('failed'); },
      async () => { reported = true; await reporting.promise; }).body!.getReader();
    try {
      expect((await read(reader)).event).toBe('error');
      expect((await reader.read()).done).toBe(true);
      expect(activity).toEqual([true, false]); expect(reported).toBe(true);
    } finally { reporting.resolve(); await reader.cancel(); }
  });

  it('negotiates patch delivery per connection without changing legacy full snapshots or subscriber isolation', async () => {
    const hub = new LiveHub(), key = hub.key(['notes']);
    const state = { count: 0, padding: 'unchanged'.repeat(200) };
    const patchedRequest = new Request(url, { headers: { 'x-mmd-stream': 'live', 'x-mmd-live-patches': '1' } });
    const patched = liveResponse(hub, key, patchedRequest, async () => ({ ...state, owner: 'Ada' })).body!.getReader();
    const legacy = liveResponse(hub, key, request(), async () => ({ ...state, owner: 'Grace' })).body!.getReader();
    try {
      expect((await read(patched)).data.seq).toBe(1);
      expect((await read(legacy)).data.seq).toBeUndefined();
      state.count++; hub.invalidate(['notes']);
      const delta = await read(patched), complete = await read(legacy);
      expect(delta).toEqual({ event: 'patch', data: { base: 1, seq: 2,
        patch: [{ op: 'replace', path: '/count', value: 1 }], stamp: expect.objectContaining({ revision: 1 }) } });
      expect(complete.event).toBe('value');
      expect(complete.data.value).toEqual({ ...state, owner: 'Grace' });
      hub.invalidate(['notes']);
      const unchanged = await read(patched);
      expect(unchanged.event).toBe('patch'); expect(unchanged.data.patch).toEqual([]);
      expect(unchanged.data.stamp.revision).toBe(2);
      await read(legacy);
      // Reconnection has its own full baseline, not the previous connection's sequence.
      const reconnected = liveResponse(hub, key, patchedRequest, async () => state).body!.getReader();
      try { expect(await read(reconnected)).toEqual({ event: 'value', data: { value: state, seq: 1, stamp: expect.objectContaining({ revision: 2 }) } }); }
      finally { await reconnected.cancel(); }
    } finally { await patched.cancel(); await legacy.cancel(); }
  });

  it('updates an overview and its targeted detail using the same positional mutation arguments, without querying siblings', async () => {
    const define = createDefine<{ user: string }, unknown, { rows: Record<string, number> }>();
    define.service('rows', () => ({ one: 0, two: 0 }));
    const app = serve({ define, state: req => ({ user: req.headers.get('x-user') ?? 'viewer' }) });
    const queries = { overview: 0, one: 0, two: 0 };
    let updateArguments: unknown[] = [];
    install(app, createServerFunctionRoutes<{ user: string }, unknown, { rows: Record<string, number> }>([
      { id: 'overview', method: 'GET', path: '/_fn/tree/overview', parameters: [], live: () => ['notes'],
        async handler({ services }) { queries.overview++; return services.rows; } },
      { id: 'detail', method: 'GET', path: '/_fn/tree/detail', parameters: [{ name: 'id', optional: false, queryKind: 'string' }],
        live: (_context, id) => ['notes', String(id)],
        async handler({ services }, id) { queries[String(id) as 'one' | 'two']++; return services.rows[String(id)]; } },
      { id: 'save', method: 'POST', path: '/_fn/tree/save', parameters: [{ name: 'text', optional: false }, { name: 'expeditionId', optional: false }],
        updates: ({ state }, message, id) => { updateArguments = [state.user, message, id]; return ['notes', String(id)]; },
        async handler({ services, state }, text, expeditionId) {
          services.rows[String(expeditionId)]!++;
          return { user: state.user, text, expeditionId };
        } },
    ]));
    const readers = await Promise.all(['overview', 'detail?id=one', 'detail?id=two'].map(async path =>
      (await app.fetch(new Request('https://app.test/_fn/tree/' + path, { headers: { 'x-mmd-stream': 'live' } }))).body!.getReader(),
    ));
    try {
      await Promise.all(readers.map(read));
      const posted = await app.fetch(new Request('https://app.test/_fn/tree/save', {
        method: 'POST', headers: { 'x-user': 'writer', 'content-type': 'application/json' },
        // Transport field order differs; declaration order still determines arguments.
        body: JSON.stringify({ expeditionId: 'one', text: 'hello' }),
      }));
      expect(await posted.json()).toEqual({ user: 'writer', text: 'hello', expeditionId: 'one' });
      expect(updateArguments).toEqual(['writer', 'hello', 'one']);
      expect(JSON.parse(posted.headers.get('x-mmd-updates')!)).toEqual([
        expect.objectContaining({ key: '["notes","one"]', revision: 1 }),
      ]);
      expect((await read(readers[0]!)).data.value).toEqual({ one: 1, two: 0 });
      expect((await read(readers[1]!)).data.value).toBe(1);
      expect(queries).toEqual({ overview: 2, one: 2, two: 1 });
      define.invalidate(['notes']);
      await Promise.all(readers.map(read));
      expect(queries).toEqual({ overview: 3, one: 3, two: 2 });
    } finally { await Promise.all(readers.map(reader => reader.cancel())); }
  });

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
    const key = hub.key(['notes']);
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

  it('invalidates parent queries only when a child-key generator mutation completes successfully', async () => {
    const app = serve({ define: createDefine() });
    let value = 0, queries = 0;
    install(app, createServerFunctionRoutes([
      { id: 'overview', method: 'GET', path: '/_fn/generator/overview', parameters: [], live: () => ['notes'],
        async handler() { queries++; return value; } },
      { id: 'save', method: 'POST', path: '/_fn/generator/save', parameters: [], updates: () => ['notes', 'one'],
        async *handler() { yield 'starting'; value = 1; yield 'saved'; } },
    ]));
    const overview = (await app.fetch(new Request('https://app.test/_fn/generator/overview', { headers: { 'x-mmd-stream': 'live' } }))).body!.getReader();
    let mutation: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      expect((await read(overview)).data.value).toBe(0);
      mutation = (await app.fetch(new Request('https://app.test/_fn/generator/save', { method: 'POST', headers: { 'x-mmd-stream': 'generator' } }))).body!.getReader();
      expect((await read(mutation)).data.value).toBe('starting');
      expect(queries).toBe(1);
      expect((await read(mutation)).data.value).toBe('saved');
      const complete = await read(mutation);
      expect(complete.event).toBe('done');
      expect(complete.data.updates).toEqual([expect.objectContaining({ key: '["notes","one"]', revision: 1 })]);
      expect((await read(overview)).data.value).toBe(1);
      expect(queries).toBe(2);
    } finally { await overview.cancel(); await mutation?.cancel(); }
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
