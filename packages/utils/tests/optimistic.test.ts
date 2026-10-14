import { waitFor, type FetchStub } from '../../../test-support/helpers';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'bun:test';
import {
  $fetch,
  $forms,
  clearDataRuntime,
  createDataRuntime,
  runWithDataRuntime,
  RequestError,
  type FetchResource,
  type ResolvedValue,
  type StandardSchemaV1,
} from '@memoized-dom/data';
import { optimistic, type OptimisticCallOptions } from '../src';
import { createStreamingSource, disposeFetchResource } from '@memoized-dom/data/internal';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(() => clearDataRuntime());

describe('optimistic', () => {
  it('protects parent and child live sources through overlapping responses and waits for acknowledged snapshots', async () => {
    const encoder = new TextEncoder();
    const feeds = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    const stamp = (revision: number, key = '["notes","one"]') => ({ epoch: 'one', key, revision });
    const emit = (path: string, value: unknown, revision: number) => feeds.get(path)!.enqueue(encoder.encode(
      `event: value\ndata: ${JSON.stringify({ value, stamp: stamp(revision, path === '/summary' ? '["notes"]' : '["notes","one"]') })}\n\n`,
    ));
    const runtime = createDataRuntime({ baseURL: 'https://app.test', fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/save') {
        const text = JSON.parse(String(init!.body)).text as string;
        const work = deferred<Response>(); pending.set(text, work); return work.promise;
      }
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { feeds.set(path, controller); } }), {
        headers: { 'content-type': 'text/event-stream' },
      });
    } });
    try {
      const notes = runWithDataRuntime(runtime, () => createStreamingSource<{ id: string; text: string }[]>('/notes', {}, 'live'));
      const summary = runWithDataRuntime(runtime, () => createStreamingSource<{ count: number }>('/summary', {}, 'live'));
      const rows = notes as unknown as FetchResource<{ id: string; text: string }[]>;
      const count = summary as unknown as FetchResource<{ count: number }>;
      emit('/notes', [{ id: 'A', text: 'A' }], 0); emit('/summary', { count: 1 }, 0);
      await runtime.settle();
      const save = optimistic({
        source: [notes, summary],
        action: (text: string) => runtime.$fetch<{ id: string; text: string }>('/save', { method: 'POST', body: { text } }),
        apply(text, id) {
          rows.mutate(items => items!.push({ id, text })); count.mutate(value => { value!.count++; });
          return () => {
            rows.mutate(items => { const index = items!.findIndex(item => item.id === id); if (index !== -1) items!.splice(index, 1); });
            count.mutate(value => { value!.count--; });
          };
        },
        reconcile(saved, _text, id) {
          rows.mutate(items => { const index = items!.findIndex(item => item.id === id); if (index !== -1) items!.splice(index, 1, saved); });
        },
      });
      const first = save('C'), second = save('E');
      expect(count.data?.count).toBe(3);
      emit('/notes', [{ id: 'A', text: 'A' }, { id: 'D', text: 'D' }], 1); emit('/summary', { count: 2 }, 1);
      await Bun.sleep(10);
      expect(rows.data!.map(row => row.text)).toEqual(['A', 'C', 'E']);
      pending.get('E')!.resolve(Response.json({ id: 'E', text: 'E' }, { headers: { 'x-mmd-updates': JSON.stringify([stamp(2)]) } }));
      await waitFor(() => expect(rows.data!.some(row => row.id === 'E')).toBe(true));
      expect(rows.data!.map(row => row.text)).toEqual(['A', 'C', 'E']);
      pending.get('C')!.resolve(Response.json({ id: 'C', text: 'C' }, { headers: { 'x-mmd-updates': JSON.stringify([stamp(3)]) } }));
      await runtime.settle();
      // The latest buffered snapshot is older than both acknowledgements.
      expect(rows.data!.map(row => row.id)).toEqual(['A', 'C', 'E']);
      expect(count.data?.count).toBe(3);
      emit('/notes', ['A', 'D', 'E', 'C'].map(id => ({ id, text: id })), 3); emit('/summary', { count: 4 }, 3);
      await waitFor(() => expect(rows.data!.map(row => row.id)).toEqual(['A', 'D', 'E', 'C']));
      expect(count.data?.count).toBe(4);
      disposeFetchResource(first); disposeFetchResource(second);
    } finally { runtime.clear(); }
  });

  it('preserves transparent source and form payload types', () => {
    const schema: StandardSchemaV1<unknown, { id: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ value: { id: 'a' } }),
      },
    };
    const submit = optimistic({
      action: (fields: { id: string }) => $fetch<{ savedId: string }>(`/vote/${fields.id}`, { method: 'POST' }),
      apply: () => () => {},
      reconcile(saved) { expectTypeOf(saved.savedId).toEqualTypeOf<string>(); },
    });
    expectTypeOf(submit).returns.toEqualTypeOf<ResolvedValue<{ savedId: string }>>();
    expectTypeOf<Parameters<typeof submit>[1]>()
      .toEqualTypeOf<OptimisticCallOptions | undefined>();
    const form = $forms({ schema, action: submit });
    expectTypeOf(form.result).toEqualTypeOf<{ savedId: string } | undefined>();
  });

  it('replaces each temporary row with its own returned data, without refetching', async () => {
    const work = new Map('abcd'.split('').map(letter => [letter, deferred<{ id: string; text: string }>()]));
    const rows: Array<{ id: string; text: string; pending: boolean }> = [];
    const submit = optimistic({
      action: (text: string) => work.get(text)!.promise,
      apply(text, id) {
        rows.push({ id, text, pending: true });
        return () => {
          const index = rows.findIndex(row => row.id === id);
          if (index !== -1) rows.splice(index, 1);
        };
      },
      reconcile(saved, _text, id) {
        const index = rows.findIndex(row => row.id === id);
        if (index !== -1) rows.splice(index, 1, { ...saved, pending: false });
      },
    });

    for (const letter of 'abcd') submit(letter);
    expect(rows.map(row => row.text)).toEqual(['a', 'b', 'c', 'd']);
    work.get('c')!.resolve({ id: 'server-c', text: 'C' });
    await waitFor(() => expect(rows[2]).toEqual({ id: 'server-c', text: 'C', pending: false }));
    work.get('a')!.reject(new Error('a failed'));
    await waitFor(() => expect(rows).toHaveLength(3));
    work.get('d')!.resolve({ id: 'server-d', text: 'D' });
    work.get('b')!.resolve({ id: 'server-b', text: 'B' });
    await waitFor(() => expect(rows).toEqual([
      { id: 'server-b', text: 'B', pending: false },
      { id: 'server-c', text: 'C', pending: false },
      { id: 'server-d', text: 'D', pending: false },
    ]));
  });

  it('preserves a plain promise, gives each call an ID, and rolls back failures in settlement order', async () => {
    const work = new Map('abcdef'.split('').map(letter => [letter, deferred<string>()]));
    const ids = new Map<string, string>();
    const errors: string[] = [];
    let count = 0;
    const submit = optimistic({
      action: (letter: string) => work.get(letter)!.promise,
      apply(letter, id) {
        ids.set(letter, id);
        count++;
        return error => {
          count--;
          errors.push(`${letter}:${error.message}`);
        };
      },
    });

    for (const letter of 'abcdef') {
      expect(submit(letter)).toBe(work.get(letter)!.promise);
    }
    expect(count).toBe(6);
    expect(new Set(ids.values()).size).toBe(6);

    const failures = new Set(['b', 'e', 'f']);
    for (const letter of ['d', 'b', 'f', 'a', 'e', 'c']) {
      if (failures.has(letter)) work.get(letter)!.reject(new Error(`${letter} failed`));
      else work.get(letter)!.resolve(letter);
      await waitFor(() => expect(count).toBe(
        6 - ['d', 'b', 'f', 'a', 'e', 'c'].slice(0, ['d', 'b', 'f', 'a', 'e', 'c'].indexOf(letter) + 1)
          .filter(item => failures.has(item)).length,
      ));
    }
    expect(count).toBe(3);
    expect(errors).toEqual(['b:b failed', 'f:f failed', 'e:e failed']);
  });

  it('tracks existing fetch sources directly and returns the exact source', async () => {
    const responses = new Map<string, ReturnType<typeof deferred<Response>>>();
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const key = String(new URL(String(input)).searchParams.get('id'));
      const response = deferred<Response>();
      responses.set(key, response);
      expect(init?.method).toBe('POST');
      return response.promise;
    });
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: fetcher as FetchStub,
    });
    let votes = 0;
    const ids: string[] = [];
    const failed: RequestError[] = [];
    const saved: number[] = [];
    const submit = optimistic({
      action: (id: string) => runtime.$fetch<number>(`/vote?id=${id}`, { method: 'POST' }),
      apply(_id, operationId) {
        ids.push(operationId);
        votes++;
        return error => {
          votes--;
          failed.push(error);
        };
      },
      reconcile(value) { saved.push(value); },
    });

    const first: FetchResource<number> = submit('first');
    const second = submit('second');
    const third = submit('third');
    expect(first.pending).toBe(true);
    expect(votes).toBe(3);
    expect(new Set(ids).size).toBe(3);
    await waitFor(() => expect(responses.size).toBe(3));

    responses.get('second')!.resolve(Response.json(2));
    await waitFor(() => expect(second.status).toBe('success'));
    responses.get('first')!.resolve(Response.json({ message: 'denied' }, { status: 409 }));
    await waitFor(() => expect(first.status).toBe('error'));
    responses.get('third')!.resolve(Response.json(3));
    await waitFor(() => expect(third.status).toBe('success'));

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(votes).toBe(2);
    expect(failed).toHaveLength(1);
    expect(saved).toEqual([2, 3]);
    expect(failed[0]).toMatchObject({ kind: 'http', status: 409, data: { message: 'denied' } });
    runtime.clear();
  });

  it.each([
    { order: [0, 1, 2] },
    { order: [2, 0, 1] },
    { order: [1, 2, 0] },
  ])('reconciles one grouped burst once, in response order %j', async ({ order }) => {
    const responses: Array<ReturnType<typeof deferred<Response>>> = [];
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: (() => {
        const response = deferred<Response>();
        responses.push(response);
        return response.promise;
      }) as FetchStub,
    });
    let count = 0;
    const operationIds: string[] = [];
    const reconcile = vi.fn((saved: { count: number }, _payload: number, _id: string) => {
      count = saved.count;
    });
    const submit = optimistic({
      action: (index: number) => runtime.$fetch<{ count: number }>(`/counter?call=${index}`, { method: 'POST' }),
      apply(_index, operationId) {
        operationIds.push(operationId);
        count++;
        return () => { count--; };
      },
      reconcile,
    });
    const sources = [0, 1, 2].map(index => submit(index, { id: 'counter' }));
    expect(count).toBe(3);
    expect(new Set(operationIds).size).toBe(3);
    await waitFor(() => expect(responses).toHaveLength(3));

    for (const [position, index] of order.entries()) {
      responses[index]!.resolve(Response.json({ count: index + 1 }));
      await waitFor(() => expect(sources[index]!.status).toBe('success'));
      if (position < 2) expect(reconcile).not.toHaveBeenCalled();
      expect(count).toBe(3);
    }
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({ count: 3 }, 2, operationIds[2]!);
    runtime.clear();
  });

  it('settles resource IDs independently and keeps ungrouped calls immediate', async () => {
    const responses: Array<ReturnType<typeof deferred<Response>>> = [];
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: (() => {
        const response = deferred<Response>();
        responses.push(response);
        return response.promise;
      }) as FetchStub,
    });
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    let call = 0;
    const reconcile = vi.fn((saved: { count: number }, resource: string) => {
      counts[resource] = saved.count;
    });
    const submit = optimistic({
      action: (_resource: string) => runtime.$fetch<{ count: number }>(`/counter?call=${call++}`, { method: 'POST' }),
      apply(resource) {
        counts[resource]!++;
        return () => { counts[resource]!--; };
      },
      reconcile,
    });
    const sources = [submit('a', { id: 'a' }), submit('a', { id: 'a' }),
      submit('b', { id: 0 }), submit('c')];
    await waitFor(() => expect(responses).toHaveLength(4));
    responses[2]!.resolve(Response.json({ count: 10 }));
    responses[3]!.resolve(Response.json({ count: 20 }));
    await waitFor(() => expect(counts).toEqual({ a: 2, b: 10, c: 20 }));
    responses[0]!.resolve(Response.json({ count: 1 }));
    await waitFor(() => expect(sources[0]!.status).toBe('success'));
    expect(counts.a).toBe(2);
    expect(reconcile).toHaveBeenCalledTimes(2);
    responses[1]!.resolve(Response.json({ count: 2 }));
    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(3));
    runtime.clear();
  });

  it('keeps individual rollbacks and falls back to the latest successful grouped call', async () => {
    const responses: Array<ReturnType<typeof deferred<Response>>> = [];
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: (() => {
        const response = deferred<Response>();
        responses.push(response);
        return response.promise;
      }) as FetchStub,
    });
    let count = 0;
    const rollback = vi.fn();
    const reconcile = vi.fn((saved: { count: number }, _payload: number, _id: string) => {
      count = saved.count;
    });
    const submit = optimistic({
      action: (index: number) => runtime.$fetch<{ count: number }>(`/counter?call=${index}`, { method: 'POST' }),
      apply(index, operationId) {
        count++;
        return error => { count--; rollback(index, operationId, error); };
      },
      reconcile,
    });
    const sources = [0, 1, 2].map(index => submit(index, { id: 'counter' }));
    await waitFor(() => expect(responses).toHaveLength(3));
    responses[1]!.resolve(Response.json({ count: 1 }));
    await waitFor(() => expect(sources[1]!.status).toBe('success'));
    responses[2]!.resolve(Response.json({ message: 'Newest failed' }, { status: 409 }));
    await waitFor(() => expect(count).toBe(2));
    expect(reconcile).not.toHaveBeenCalled();
    responses[0]!.resolve(Response.json({ message: 'Oldest failed' }, { status: 409 }));
    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    expect(count).toBe(1);
    expect(rollback.mock.calls.map(([index]) => index)).toEqual([2, 0]);
    expect(reconcile.mock.calls[0]?.slice(0, 2)).toEqual([{ count: 1 }, 1]);

    const next = submit(3, { id: 'counter' });
    await waitFor(() => expect(responses).toHaveLength(4));
    responses[3]!.resolve(Response.json({ count: 2 }));
    await waitFor(() => expect(next.status).toBe('success'));
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(count).toBe(2);
    runtime.clear();
  });

  it('does not leave a resource group waiting on an aborted call', async () => {
    const responses: Array<ReturnType<typeof deferred<Response>>> = [];
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: (() => {
        const response = deferred<Response>();
        responses.push(response);
        return response.promise;
      }) as FetchStub,
    });
    const reconcile = vi.fn();
    const submit = optimistic({
      action: (index: number) => runtime.$fetch<{ count: number }>(`/counter?call=${index}`, { method: 'POST' }),
      apply: () => () => {},
      reconcile,
    });
    const first = submit(0, { id: 'counter' });
    const last = submit(1, { id: 'counter' });
    await waitFor(() => expect(responses).toHaveLength(2));
    responses[1]!.resolve(Response.json({ count: 1 }));
    await waitFor(() => expect(last.status).toBe('success'));
    expect(reconcile).not.toHaveBeenCalled();
    first.abort();
    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    expect(reconcile.mock.calls[0]?.slice(0, 2)).toEqual([{ count: 1 }, 1]);
    runtime.clear();
  });

  it('releases failed startup groups and preserves grouped promise results', async () => {
    const work = deferred<number>();
    const reconcile = vi.fn();
    let first = true;
    const submit = optimistic({
      action: (_payload: string) => {
        if (first) {
          first = false;
          throw new Error('Failed before dispatch');
        }
        return work.promise;
      },
      apply: () => () => {},
      reconcile,
    });
    expect(() => submit('first', { id: 'counter' })).toThrow('Failed before dispatch');
    expect(submit('second', { id: 'counter' })).toBe(work.promise);
    work.resolve(2);
    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    expect(reconcile.mock.calls[0]?.slice(0, 2)).toEqual([2, 'second']);
  });

  it('uses the same operation with a form and retains form submission errors', async () => {
    const work = new Map([['a', deferred<number>()], ['b', deferred<number>()]]);
    const schema: StandardSchemaV1<unknown, { id: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          const id = (value as { id?: string }).id;
          return id === 'a' || id === 'b'
            ? { value: { id } }
            : { issues: [{ message: 'Invalid id', path: ['id'] }] };
        },
      },
    };
    let count = 0;
    const submit = optimistic({
      action: (fields: { id: string }) => work.get(fields.id)!.promise,
      apply() {
        count++;
        return () => { count--; };
      },
    });
    const form = $forms({ schema, action: submit });
    const fields = (id: string) => {
      const data = new FormData();
      data.set('id', id);
      return data;
    };

    form.submit(fields('invalid'));
    await waitFor(() => expect(form.errors[0]?.kind).toBe('parse'));
    expect(count).toBe(0);

    form.submit(fields('a'));
    form.submit(fields('b'));
    await waitFor(() => expect(count).toBe(2));
    expect(form.pending).toBe(true);
    work.get('b')!.reject(new Error('b rejected'));
    await waitFor(() => expect(count).toBe(1));
    expect(form.errors).toMatchObject([{ kind: 'submit', message: 'b rejected' }]);
    work.get('a')!.resolve(1);
    await waitFor(() => expect(form.pending).toBe(false));
    expect(count).toBe(1);
  });

  it('lets a server-side form settle a tracked fetch result as its payload', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: 'saved-message' }));
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: fetcher as FetchStub,
    });
    const schema: StandardSchemaV1<unknown, { message: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          return { value: { message: String((value as { message: string }).message) } };
        },
      },
    };
    let temporary = '';
    const submit = optimistic({
      action: (fields: { message: string }) => runtime.$fetch<{ id: string }>('/messages', {
        method: 'POST', body: { message: fields.message },
      }),
      apply(fields) {
        temporary = fields.message;
        return () => { temporary = ''; };
      },
      reconcile(saved) { temporary = saved.id; },
    });
    const form = $forms({ schema, action: submit });
    const data = new FormData();
    data.set('message', 'hello');
    form.submit(data);
    await waitFor(() => expect(form.pending).toBe(false));
    expect(form.errors).toEqual([]);
    expect(form.result).toEqual({ id: 'saved-message' });
    expect(temporary).toBe('saved-message');
    expect(fetcher).toHaveBeenCalledTimes(1);
    runtime.clear();
  });

  it('rejects synchronous results and repeated source operations', async () => {
    const invalid = optimistic({
      action: (_value: string) => 1 as never,
      apply: () => () => {},
    });
    expect(() => invalid('x')).toThrow('trackable source or promise');

    const promise = Promise.resolve(1);
    const reusedPromise = optimistic({
      action: () => promise,
      apply: () => () => {},
    });
    expect(reusedPromise(undefined)).toBe(promise);
    expect(() => reusedPromise(undefined)).toThrow('new operation');

    const response = deferred<Response>();
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: (() => response.promise) as FetchStub,
    });
    const source = runtime.$fetch('/vote', { method: 'POST' });
    const submit = optimistic({ action: () => source, apply: () => () => {} });
    expect(submit(undefined)).toBe(source);
    expect(() => submit(undefined)).toThrow('new operation');
    response.resolve(Response.json({ ok: true }));
    await waitFor(() => expect(source.status).toBe('success'));
    expect(() => submit(undefined)).toThrow('new operation');
    runtime.clear();
  });
});
