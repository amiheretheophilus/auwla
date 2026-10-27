import { waitFor, type FetchStub } from '../../../test-support/helpers';
import { describe, expect, it, vi } from 'bun:test';
import { createBuildScope } from '@memoized-dom/runtime';
import { ownSourceFrame } from '../src/source-scope';
import {
  $fetch,
  $read,
  $track,
  createDataRuntime,
  RequestError,
  runWithDataRuntime,
  UnresolvedDataReadError,
  type ResolvedValue,
} from '../src';
import {
  connectResolvedValue,
  createEventSourceSlot,
  disposeEventSourceSlot,
  rebindEventSourceSlot,
  rebindResolvedValue,
  rebindResolvedValueFromFactory,
  readResolvedValue,
  readResolvedValueForRender,
  retryResolvedValues,
  settleRoutedValue,
  withRoutedSources,
} from '../src/internal';

interface User {
  id: number;
  name: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transparent resolved values', () => {
  it('rejects an opaque render-time action before starting its request', () => {
    const fetcher = vi.fn(async () => json({ saved: true }));
    const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
    const scope = createBuildScope();
    const frame = scope.enter();

    ownSourceFrame(frame, null);

    expect(() => runWithDataRuntime(runtime, () => $fetch('/save', { method: 'POST' })))
      .toThrow('actions must run from an event handler, effect or deferred callback');
    expect(fetcher).not.toHaveBeenCalled();

    scope.leave(frame);
    runtime.clear();
  });

  it('awaits a POST facade through the original request and dispatches only once', async () => {
    const fetcher = vi.fn(async () => json({ id: 1, name: 'Lin' }));
    const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
    const result = runWithDataRuntime(runtime, () => {
      return $fetch<User>('/users', { method: 'POST', body: { name: 'Lin' } });
    });

    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual({ id: 1, name: 'Lin' });
    expect(fetcher).toHaveBeenCalledTimes(1);

    runtime.clear();
  });

  it('rejects a failed action with the original request error', async () => {
    const fetcher = vi.fn(async () => json({ message: 'offline' }, 503));
    const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
    const result = runWithDataRuntime(runtime, () => $fetch('/users', { method: 'POST' }));

    await expect(result).rejects.toMatchObject({ kind: 'http', status: 503, message: 'offline' });
    expect(fetcher).toHaveBeenCalledTimes(1);

    runtime.clear();
  });

  it('treats an initial null target as a committed null payload without fetching', () => {
    const fetcher = vi.fn(async () => json({ name: 'unused' }));
    const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
    const resource = runtime.$fetch<User | null>(null);
    const value = resource as unknown as ResolvedValue<User | null>;
    const state = $track(value);

    // No request ran, so the status stays `idle` (fetch-descriptor.test.ts);
    // the payload is still a committed `null` that readers never wait for.
    expect(readResolvedValue(value)).toBeNull();
    expect(resource.data).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.pending).toBe(false);
    expect(state.refreshing).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();

    runtime.clear();
  });

  it('reports no success for a request abandoned by a rebind to null', async () => {
    let respond: (response: Response) => void = () => {};
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      respond = resolve;
    }));
    const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
    const resource = runtime.$fetch<User | null>('/user');
    const value = resource as unknown as ResolvedValue<User | null>;
    const succeeded = vi.fn();

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    $track(value).onSuccess(succeeded);

    // The abandoned request's callback must never receive the paused `null`.
    rebindResolvedValue(value, null);
    respond(json({ id: 1, name: 'Ada' }));
    await runtime.settle();

    expect(succeeded).not.toHaveBeenCalled();
    expect(readResolvedValue(value)).toBeNull();

    runtime.clear();
  });

  for (const mode of ['direct', 'factory'] as const) {
    it(`clears a committed payload on a ${mode} rebind to null`, async () => {
      const fetcher = vi.fn(async () => json({ id: 1, name: 'Ada' }));
      const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
      const resource = runtime.$fetch<User | null>('/user');
      const value = resource as unknown as ResolvedValue<User | null>;
      const state = $track(value);

      await waitFor(() => expect(state.status).toBe('success'));

      if (mode === 'direct') {
        rebindResolvedValue(value, null);
      } else {
        rebindResolvedValueFromFactory(value, () => {
          return runtime.$fetch<User | null>(null) as unknown as ResolvedValue<User | null>;
        });
      }

      expect(readResolvedValue(value)).toBeNull();
      expect(resource.data).toBeNull();
      expect(state.status).toBe('idle');
      expect(state.pending).toBe(false);
      expect(state.refreshing).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);

      runtime.clear();
    });
  }

  it('settles preparation-local sources into payload caches and releases active entries', async () => {
    const fetcher = vi.fn(async () => json([{ id: 'one' }]));
    const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
    const routeState: Record<string, unknown> = {};
    const prepare = withRoutedSources(async ({ routeState }: { routeState: Record<string, unknown>; signal: AbortSignal }, read) => {
      if (routeState.items) return routeState.items;
      const items = await read(runtime.$fetch('/items'));
      routeState.items = items;
      return items;
    });
    const context = { routeState, signal: new AbortController().signal };
    expect(await prepare(context)).toEqual([{ id: 'one' }]);
    expect(JSON.parse(JSON.stringify(routeState))).toEqual({ items: [{ id: 'one' }] });
    expect(await prepare(context)).toEqual([{ id: 'one' }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const uncached = withRoutedSources(async (_context: { signal: AbortSignal }, read) => read(runtime.$fetch('/items')));
    await uncached(context);
    await uncached(context);
    expect(fetcher).toHaveBeenCalledTimes(3);
    runtime.clear();
  });

  it('retains GET deduplication for other active consumers and explicit app caching', async () => {
    const fetcher = vi.fn(async () => json({ id: 1 }));
    const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
    const active = runtime.$fetch('/shared');
    const context = { signal: new AbortController().signal };
    const prepare = withRoutedSources(async (_context: typeof context, read) => read(runtime.$fetch('/shared')));
    expect(await prepare(context)).toEqual({ id: 1 });
    expect(await prepare(context)).toEqual({ id: 1 });
    expect(active.data).toEqual({ id: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const cached = withRoutedSources(async (_context: typeof context, read) =>
      read(runtime.$fetch('/app-cache', { cache: { scope: 'app' } })));
    await cached(context);
    await cached(context);
    expect(fetcher).toHaveBeenCalledTimes(2);
    runtime.clear();
  });

  it('releases a preparation source when the gate throws', async () => {
    const fetcher = vi.fn(async () => json([1]));
    const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
    const context = { signal: new AbortController().signal };
    const failed = withRoutedSources(async (_context: typeof context, read) => {
      await read(runtime.$fetch('/items'));
      throw new Error('gate failed');
    });
    await expect(failed(context)).rejects.toThrow('gate failed');
    const next = withRoutedSources(async (_context: typeof context, read) => read(runtime.$fetch('/items')));
    expect(await next(context)).toEqual([1]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    runtime.clear();
  });

  it('cancels pending work and prevents late continuations from retaining sources', async () => {
    const runtime = createDataRuntime({ fetch: ((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })) as FetchStub });
    const controller = new AbortController();
    const prepare = withRoutedSources(async (_context: { signal: AbortSignal }, read) => read(runtime.$fetch('/pending')));
    const pending = prepare({ signal: controller.signal });
    controller.abort(new Error('navigation cancelled'));
    await expect(pending).rejects.toThrow('navigation cancelled');
    await expect(runtime.settle(20)).resolves.toBe(true);
    runtime.clear();
  });

  it('settles a colorless value into an honest routed payload', async () => {
    let finish!: (response: Response) => void;
    const runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(resolve => { finish = resolve; })) as FetchStub,
    });
    const resource = runtime.$fetch<User>('/user');
    const controller = new AbortController();
    const settled = settleRoutedValue(resource, controller.signal);

    expect(settled).toBeInstanceOf(Promise);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    finish(json({ id: 1, name: 'Ada' }));
    await expect(settled).resolves.toEqual({ id: 1, name: 'Ada' });
    expect(settleRoutedValue({ plain: true }, controller.signal)).toBeUndefined();
    runtime.clear();
  });

  it('reads a promise as a transparent source and refreshes fresh work', async () => {
    let resolve!: (user: User) => void;
    const promise = new Promise<User>(accept => {
      resolve = accept;
    });
    const runtime = createDataRuntime();
    let refreshes = 0;
    const user = runWithDataRuntime(runtime, () => $read(promise, () => {
      refreshes++;
      return Promise.resolve({ id: 2, name: 'Grace' });
    }));
    const state = $track(user);
    const success = vi.fn();
    const unsubscribe = state.onSuccess(success);

    expect($track(user)).toBe(state);
    expect(state.status).toBe('pending');
    expect(state.pending).toBe(true);
    expect(state.refreshing).toBe(false);
    expect(readResolvedValueForRender(user)).toBeUndefined();
    expect(state).not.toHaveProperty('value');
    expect(state.error).toBeNull();

    resolve({ id: 1, name: 'Ada' });
    await waitFor(() => expect(state.status).toBe('success'));

    expect(state.status).toBe('success');
    expect(state.pending).toBe(false);
    expect(readResolvedValue(user)).toEqual({ id: 1, name: 'Ada' });
    expect(success).toHaveBeenCalledWith({ id: 1, name: 'Ada' }, state.id);
    await expect(state.refresh()).resolves.toEqual({ id: 2, name: 'Grace' });
    expect(refreshes).toBe(1);
    expect(readResolvedValue(user)).toEqual({ id: 2, name: 'Grace' });
    expect(state.onSuccess(vi.fn())).toBeTypeOf('function');
    expect(() => state.abort()).not.toThrow();
    unsubscribe();
    runtime.clear();
  });

  it('exposes promise rejection through the normal tracked error surface', async () => {
    let reject!: (reason: unknown) => void;
    const promise = new Promise<User>((_resolve, fail) => {
      reject = fail;
    });
    const runtime = createDataRuntime();
    const user = runWithDataRuntime(runtime, () => $read(promise, () => Promise.resolve({ id: 3, name: 'Retry' })));
    const state = $track(user);
    const failure = vi.fn();
    state.onError(failure);

    reject(new Error('offline'));
    await waitFor(() => expect(state.status).toBe('error'));

    expect(state.status).toBe('error');
    expect(state.pending).toBe(false);
    expect(state).not.toHaveProperty('value');
    expect(state.error).toBeInstanceOf(RequestError);
    expect(failure).toHaveBeenCalledWith(state.error, state.id);
    await expect(state.refresh()).resolves.toEqual({ id: 3, name: 'Retry' });
    runtime.clear();
  });

  it('keeps the newest read after overlapping refreshes settle in reverse order', async () => {
    const pending: Array<{ resolve(value: User): void; reject(reason: unknown): void }> = [];
    const runtime = createDataRuntime();
    const user = runWithDataRuntime(runtime, () => $read(
      Promise.resolve({ id: 0, name: 'Initial' }),
      () => new Promise<User>((resolve, reject) => pending.push({ resolve, reject })),
    ));
    const request = $track(user);
    await waitFor(() => expect(request.status).toBe('success'));

    const first = request.refresh();
    const second = request.refresh();
    expect(pending).toHaveLength(2);
    pending[1]!.resolve({ id: 2, name: 'Newest' });
    await expect(second).resolves.toMatchObject({ id: 2 });
    pending[0]!.reject(new Error('old failure'));
    await expect(first).rejects.toThrow('old failure');
    expect(request.status).toBe('success');
    expect(readResolvedValue(user)).toEqual({ id: 2, name: 'Newest' });
    runtime.clear();
  });

  it('retries all failed values represented by a shared boundary', async () => {
    const requests: Array<{
      url: string;
      resolve(response: Response): void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((input: string | URL | Request) =>
        new Promise<Response>(resolve => {
          requests.push({ url: String(input), resolve });
        })) as FetchStub,
    });
    const leftResource = runtime.$fetch<User>('/left');
    const rightResource = runtime.$fetch<User>('/right');
    const left = leftResource as unknown as ResolvedValue<User>;
    const right = rightResource as unknown as ResolvedValue<User>;

    await waitFor(() => expect(requests).toHaveLength(2));
    requests[0]!.resolve(json({ message: 'left failed' }, 501));
    requests[1]!.resolve(json({ message: 'right failed' }, 502));
    await waitFor(() => {
      expect($track(left).error?.status).toBe(501);
      expect($track(right).error?.status).toBe(502);
    });

    const retry = retryResolvedValues([left, right]);
    await waitFor(() => expect(requests).toHaveLength(4));
    expect(requests[2]!.url).toBe('/left');
    expect(requests[3]!.url).toBe('/right');
    requests[2]!.resolve(json({ id: 1, name: 'Left' }));
    requests[3]!.resolve(json({ id: 2, name: 'Right' }));

    await expect(retry).resolves.toEqual([
      { id: 1, name: 'Left' },
      { id: 2, name: 'Right' },
    ]);
    runtime.clear();
  });

  it('tracks non-GET fetches through the same colorless state channel', async () => {
    let finish!: (response: Response) => void;
    let requestInit: RequestInit | undefined;
    const runtime = createDataRuntime({
      fetch: ((_input, init) => {
        requestInit = init;
        return new Promise<Response>(resolve => {
          finish = resolve;
        });
      }) as FetchStub,
    });
    const resource = runtime.$fetch<User>('/users/1', {
      method: 'PATCH',
      body: { name: 'Grace' },
    });
    const user = resource as unknown as ResolvedValue<User>;
    const state = $track(user);

    expect(state.pending).toBe(true);
    expect(requestInit?.method).toBe('PATCH');
    expect(requestInit?.body).toBe('{"name":"Grace"}');

    finish(json({ id: 1, name: 'Grace' }));
    await waitFor(() => expect(state.status).toBe('success'));

    expect(readResolvedValue(user)).toEqual({ id: 1, name: 'Grace' });
    expect(state.pending).toBe(false);
    expect(state.error).toBeNull();
    runtime.clear();
  });

  it('separates transparent value reads from tracked request state', async () => {
    let resolve!: (response: Response) => void;
    const runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as FetchStub,
    });
    const resource = runtime.$fetch<User>('/user');
    const user = resource as unknown as ResolvedValue<User>;
    const state = $track(user);

    expect(state.pending).toBe(true);
    expect(readResolvedValueForRender(user)).toBeUndefined();
    expect(() => readResolvedValue(user, 'user', 'Profile:1:1'))
      .toThrow(UnresolvedDataReadError);

    let transitions = 0;
    const disconnect = connectResolvedValue(user, () => transitions++);
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(json({ id: 1, name: 'Ada' }));
    await resource.refresh();

    expect(readResolvedValue(user)).toEqual({ id: 1, name: 'Ada' });
    expect(state.status).toBe('success');
    expect(state.pending).toBe(false);
    expect(state).not.toHaveProperty('value');
    expect(transitions).toBe(1);

    resource.update(current => ({ ...current!, name: 'Grace' }));
    expect(readResolvedValue(user).name).toBe('Grace');
    expect(state).not.toHaveProperty('value');
    expect(transitions).toBe(2);

    disconnect();
    runtime.clear();
  });

  it('keeps initial request failures loud at render and imperative sites', async () => {
    const runtime = createDataRuntime({
      fetch: (async () => json({ message: 'offline' }, 503)) as FetchStub,
    });
    const resource = runtime.$fetch<User>('/user');
    const user = resource as unknown as ResolvedValue<User>;

    await expect(resource.refresh()).rejects.toBeInstanceOf(RequestError);
    expect(() => readResolvedValueForRender(user)).toThrow(RequestError);
    expect(() => readResolvedValue(user)).toThrow(RequestError);
    runtime.clear();
  });

  it('correlates concurrent request outcomes with unique execution IDs', async () => {
    const requests: Array<(response: Response) => void> = [];
    const runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(resolve => {
        requests.push(resolve);
      })) as FetchStub,
    });
    const first = runtime.$fetch<User>('/vote', {
      method: 'POST',
      body: { id: 1 },
    }) as unknown as ResolvedValue<User>;
    const second = runtime.$fetch<User>('/vote', {
      method: 'POST',
      body: { id: 1 },
    }) as unknown as ResolvedValue<User>;
    const firstTrack = $track(first);
    const secondTrack = $track(second);
    const firstSuccess = vi.fn();
    const firstError = vi.fn();
    const secondSuccess = vi.fn();
    const secondError = vi.fn();

    expect(firstTrack.id).not.toBe(secondTrack.id);
    const firstId = firstTrack.id;
    const secondId = secondTrack.id;
    firstTrack.onSuccess(firstSuccess);
    firstTrack.onError(firstError);
    secondTrack.onSuccess(secondSuccess);
    secondTrack.onError(secondError);

    await waitFor(() => expect(requests).toHaveLength(2));
    requests[1]!(json({ id: 1, name: 'second' }));
    requests[0]!(json({ message: 'first failed' }, 503));

    await waitFor(() => {
      expect(secondSuccess).toHaveBeenCalledWith(
        { id: 1, name: 'second' },
        secondId,
      );
      expect(firstError).toHaveBeenCalledWith(
        expect.any(RequestError),
        firstId,
      );
    });
    expect(firstSuccess).not.toHaveBeenCalled();
    expect(secondError).not.toHaveBeenCalled();

    const lateSuccess = vi.fn();
    secondTrack.onSuccess(lateSuccess);
    expect(lateSuccess).toHaveBeenCalledTimes(1);

    const settledId = secondTrack.id;
    const refreshed = secondTrack.refresh();
    expect(secondTrack.id).not.toBe(settledId);
    await waitFor(() => expect(requests).toHaveLength(3));
    requests[2]!(json({ id: 1, name: 'refreshed' }));
    await expect(refreshed).resolves.toEqual({ id: 1, name: 'refreshed' });
    runtime.clear();
  });

  it('does not abort dispatched event requests when the visible slot is replaced', async () => {
    const requests: Array<{
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>(resolve => {
          requests.push({ signal: init!.signal!, resolve });
        })) as FetchStub,
    });
    const first = runtime.$fetch<User>('/vote', {
      method: 'POST',
      body: { id: 1 },
    }) as unknown as ResolvedValue<User>;
    const second = runtime.$fetch<User>('/vote', {
      method: 'POST',
      body: { id: 1 },
    }) as unknown as ResolvedValue<User>;
    const firstSuccess = vi.fn();
    const secondSuccess = vi.fn();
    $track(first).onSuccess(firstSuccess);
    $track(second).onSuccess(secondSuccess);
    const slot = createEventSourceSlot();
    let visible: ResolvedValue<User> | null = first;
    rebindEventSourceSlot(slot, () => visible, () => {});

    visible = second;
    rebindEventSourceSlot(slot, () => visible, () => {});
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]!.signal.aborted).toBe(false);

    requests[1]!.resolve(json({ id: 1, name: 'second' }));
    requests[0]!.resolve(json({ id: 1, name: 'first' }));
    await waitFor(() => {
      expect(firstSuccess).toHaveBeenCalledTimes(1);
      expect(secondSuccess).toHaveBeenCalledTimes(1);
    });
    expect(requests[0]!.signal.aborted).toBe(false);
    expect(requests[1]!.signal.aborted).toBe(false);

    disposeEventSourceSlot(slot);
    runtime.clear();
  });

  it('rebinds a stable transparent value when its query identity changes', async () => {
    const requests: Array<{
      url: string;
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>(resolve => {
          requests.push({
            url: String(input),
            signal: init!.signal!,
            resolve,
          });
        })) as FetchStub,
    });
    const resource = runtime.$fetch<User[]>('/users', {
      query: { search: 'Ada' },
    });
    const users = resource as unknown as ResolvedValue<User[]>;
    let transitions = 0;
    const disconnect = connectResolvedValue(users, () => transitions++);

    await waitFor(() => expect(requests).toHaveLength(1));
    rebindResolvedValue(users, '/users', { query: { search: 'Grace' } });
    await waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[0]!.url).toBe('/users?search=Ada');
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.url).toBe('/users?search=Grace');

    requests[1]!.resolve(json([{ id: 2, name: 'Grace' }]));
    await waitFor(() => {
      expect(readResolvedValueForRender(users)).toEqual([
        { id: 2, name: 'Grace' },
      ]);
    });

    // Replaying an equal normalized query preserves the active entry.
    rebindResolvedValue(users, '/users', { query: { search: 'Grace' } });
    await Promise.resolve();
    expect(requests).toHaveLength(2);
    expect(transitions).toBeGreaterThan(0);

    // A non-cooperative obsolete fetch cannot overwrite the current query.
    requests[0]!.resolve(json([{ id: 1, name: 'Ada' }]));
    await Promise.resolve();
    await Promise.resolve();
    expect(readResolvedValue(users)).toEqual([{ id: 2, name: 'Grace' }]);

    disconnect();
    runtime.clear();
  });

  it('rebinds through an imported factory without treating its arguments as URLs', async () => {
    const requests: Array<{
      url: string;
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>(resolve => {
          requests.push({
            url: String(input),
            signal: init!.signal!,
            resolve,
          });
        })) as FetchStub,
    });
    const getStory = (id: number): ResolvedValue<User> =>
      runtime.$fetch<User>('/_fn/stories/getStory', {
        query: { id },
      }) as unknown as ResolvedValue<User>;
    const story = getStory(1);

    await waitFor(() => expect(requests).toHaveLength(1));
    rebindResolvedValueFromFactory(story, () => getStory(2));
    await waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[0]!.url).toBe('/_fn/stories/getStory?id=1');
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.url).toBe('/_fn/stories/getStory?id=2');

    requests[1]!.resolve(json({ id: 2, name: 'Grace' }));
    await waitFor(() => {
      expect(readResolvedValueForRender(story)).toEqual({
        id: 2,
        name: 'Grace',
      });
    });

    rebindResolvedValueFromFactory(story, () => getStory(2));
    await Promise.resolve();
    expect(requests).toHaveLength(2);
    runtime.clear();
  });

  it('rebinds method and body as reactive request inputs', async () => {
    const requests: Array<{
      method: string | undefined;
      body: BodyInit | null | undefined;
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((_input, init) => new Promise<Response>(resolve => {
        requests.push({
          method: init?.method,
          body: init?.body,
          signal: init?.signal as AbortSignal,
          resolve,
        });
      })) as FetchStub,
    });
    const resource = runtime.$fetch<User>('/users/1', {
      method: 'PATCH',
      body: { name: 'Ada' },
    });
    const user = resource as unknown as ResolvedValue<User>;

    await waitFor(() => expect(requests).toHaveLength(1));
    rebindResolvedValue(user, '/users/1', {
      method: 'PUT',
      body: { name: 'Grace' },
    });
    await waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[0]).toMatchObject({ method: 'PATCH', body: '{"name":"Ada"}' });
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]).toMatchObject({ method: 'PUT', body: '{"name":"Grace"}' });

    requests[1]!.resolve(json({ id: 1, name: 'Grace' }));
    await waitFor(() => {
      expect(readResolvedValueForRender(user)).toEqual({ id: 1, name: 'Grace' });
    });

    rebindResolvedValue(user, '/users/1', {
      method: 'PUT',
      body: { name: 'Grace' },
    });
    await Promise.resolve();
    expect(requests).toHaveLength(2);

    requests[0]!.resolve(json({ id: 1, name: 'Ada' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(readResolvedValue(user)).toEqual({ id: 1, name: 'Grace' });
    runtime.clear();
  });

  it('claims SSR state for an initial request and fetches after a query rebind', async () => {
    const server = createDataRuntime({
      fetch: (async () => json([{ id: 1, name: 'Ada' }])) as FetchStub,
    });
    server.$fetch<User[]>('/users');
    expect(await server.settle()).toBe(true);
    const state = server.serializeState();

    const requests: string[] = [];
    const client = createDataRuntime({
      fetch: (async (input: string | URL | Request) => {
        requests.push(String(input));
        return json([{ id: 2, name: 'Grace' }]);
      }) as FetchStub,
    });
    client.restoreState(state);
    const resource = client.$fetch<User[]>('/users');
    const users = resource as unknown as ResolvedValue<User[]>;

    expect(readResolvedValue(users)).toEqual([{ id: 1, name: 'Ada' }]);
    expect(requests).toHaveLength(0);

    rebindResolvedValue(users, '/users', {
      query: { search: 'Grace' },
    });
    await waitFor(() => expect(requests).toEqual(['/users?search=Grace']));
    await waitFor(() => {
      expect(readResolvedValueForRender(users)).toEqual([
        { id: 2, name: 'Grace' },
      ]);
    });

    server.clear();
    client.clear();
  });
});
