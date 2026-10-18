import { expect, it, vi } from 'bun:test';
import { createDataRuntime, runWithDataRuntime, type FetchResource } from '@memoized-dom/data';
import { createStreamingSource } from '@memoized-dom/data/internal';
import { optimistic } from '@memoized-dom/utils';
import { waitFor } from '../../../test-support/helpers';

type Note = { id: string; text: string };
const stamp = (revision: number) => ({ epoch: 'server', key: '["notes"]', revision });

function diagnostics(environment = 'development') {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = environment;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  return { warn, restore() {
    warn.mockRestore(); debug.mockRestore();
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  } };
}

async function fixture() {
  const response = Promise.withResolvers<Response>();
  let feed!: ReadableStreamDefaultController<Uint8Array>;
  const runtime = createDataRuntime({ baseURL: 'https://app.test', fetch: async (input) => {
    if (new URL(String(input)).pathname === '/save') return response.promise;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { feed = controller; } }), {
      headers: { 'content-type': 'text/event-stream' },
    });
  } });
  const notes = runWithDataRuntime(runtime, () => createStreamingSource<Note[]>('/notes', {}, 'live'));
  const rows = notes as unknown as FetchResource<Note[]>;
  const emit = (value: Note[], revision: number) => feed.enqueue(new TextEncoder().encode(
    `event: value\ndata: ${JSON.stringify({ value, stamp: stamp(revision) })}\n\n`,
  ));
  emit([], 0); await runtime.settle();
  return { runtime, notes, rows, response, emit,
    save: () => runtime.$fetch<Note>('/save', { method: 'POST' }),
    succeed() { response.resolve(Response.json({ id: 'saved', text: 'Saved' }, {
      headers: { 'x-mmd-updates': JSON.stringify([stamp(2)]) },
    })); },
  };
}

it('rejects a forgotten synchronous action return and releases protection without applying an optimistic change', async () => {
  const data = await fixture(), logs = diagnostics();
  const apply = vi.fn(() => () => {});
  try {
    const submit = optimistic({ source: data.notes, action: (_input: string) => {
      data.save(); return undefined as never;
    }, apply });
    expect(() => submit('note')).toThrow('trackable source or promise');
    expect(apply).not.toHaveBeenCalled();
    data.emit([{ id: 'external', text: 'External' }], 1);
    await waitFor(() => expect(data.rows.data?.[0]?.id).toBe('external'));
    data.succeed(); await data.runtime.settle();
    expect(logs.warn).not.toHaveBeenCalled();
  } finally { data.runtime.clear(); logs.restore(); }
});

it.each(['promise', 'async-void'] as const)('explains pending-only protection without rejecting a supported %s action', async kind => {
  const data = await fixture(), logs = diagnostics();
  const work = Promise.withResolvers<Note>();
  try {
    const result = kind === 'promise' ? work.promise : (async () => { await work.promise; })();
    const submit = optimistic({ source: data.notes, action: () => result, apply(_input: string, operationId) {
      data.rows.mutate(rows => { rows!.push({ id: operationId, text: 'Optimistic' }); });
      return () => {};
    } });
    expect(submit('note')).toBe(result);
    data.emit([{ id: 'external', text: 'External' }], 1);
    await Bun.sleep(10);
    expect(data.rows.data?.[0]?.text).toBe('Optimistic');
    work.resolve({ id: 'saved', text: 'Saved' });
    await waitFor(() => expect(logs.warn).toHaveBeenCalledTimes(1));
    expect(logs.warn.mock.calls[0]).toEqual(['[memoized-dom:live] missing-mutation-confirmation',
      expect.objectContaining({ reason: 'pending-only-protection', keys: ['["notes"]'] })]);
    await waitFor(() => expect(data.rows.data?.[0]?.id).toBe('external'));
  } finally { work.resolve({ id: 'saved', text: 'Saved' }); data.runtime.clear(); logs.restore(); }
});

it('accepts a Note mutation result for a Note[] live source and retains its acknowledgement', async () => {
  const data = await fixture(), logs = diagnostics();
  try {
    const submit = optimistic({ source: data.notes, action: () => data.save(), apply(_input: string, id) {
      data.rows.mutate(rows => { rows!.push({ id, text: 'Optimistic' }); });
      return () => { data.rows.update(() => []); };
    }, reconcile(saved, _input, id) {
      data.rows.mutate(rows => {
        const index = rows!.findIndex(row => row.id === id);
        rows!.splice(index, 1, saved);
      });
    } });
    const result = submit('note');
    data.emit([{ id: 'old', text: 'Old snapshot' }], 1);
    data.succeed();
    await waitFor(() => expect(result.status).toBe('success'));
    expect(data.rows.data).toEqual([{ id: 'saved', text: 'Saved' }]);
    expect(logs.warn).not.toHaveBeenCalled();
    data.emit([{ id: 'saved', text: 'Saved' }, { id: 'external', text: 'External' }], 2);
    await waitFor(() => expect(data.rows.data).toHaveLength(2));
  } finally { data.runtime.clear(); logs.restore(); }
});

it.each(['reconcile', 'rollback'] as const)('identifies a failed %s callback without swallowing its error or retaining protection', async phase => {
  const data = await fixture(), logs = diagnostics();
  const callbackError = new TypeError('Invalid application reconciliation');
  const reported = vi.fn();
  const originalReporter = Object.getOwnPropertyDescriptor(globalThis, 'reportError');
  try {
    Object.defineProperty(globalThis, 'reportError', { configurable: true, writable: true, value: reported });
    const submit = optimistic({ source: data.notes, action: () => data.save(), apply(_input: string) {
      return () => { if (phase === 'rollback') throw callbackError; };
    }, reconcile() { if (phase === 'reconcile') throw callbackError; } });
    submit('note');
    data.emit([{ id: 'buffered', text: 'Buffered' }], 1);
    if (phase === 'reconcile') data.succeed();
    else data.response.resolve(Response.json({ message: 'Rejected' }, { status: 400 }));
    await waitFor(() => expect(reported).toHaveBeenCalledWith(callbackError));
    expect(logs.warn.mock.calls).toContainEqual(['[memoized-dom:live] optimistic-callback-failed',
      expect.objectContaining({ phase, operationId: expect.any(String), error: callbackError })]);
    data.emit([{ id: 'current', text: 'Current' }], 3);
    await waitFor(() => expect(data.rows.data?.[0]?.id).toBe('current'));
  } finally {
    data.runtime.clear(); logs.restore();
    if (originalReporter === undefined) Reflect.deleteProperty(globalThis, 'reportError');
    else Object.defineProperty(globalThis, 'reportError', originalReporter);
  }
});

it('keeps successful protected promises quiet in production', async () => {
  const data = await fixture(), logs = diagnostics('production');
  try {
    const submit = optimistic({ source: data.notes, action: () => Promise.resolve(1), apply: () => () => {} });
    submit(undefined); await data.runtime.settle();
    expect(logs.warn).not.toHaveBeenCalled();
  } finally { data.runtime.clear(); logs.restore(); }
});

it('does not warn about ordinary promises when no live source is protected', async () => {
  const logs = diagnostics();
  try {
    const reconcile = vi.fn();
    const submit = optimistic({ action: () => Promise.resolve(1), apply: () => () => {}, reconcile });
    submit(undefined);
    await waitFor(() => expect(reconcile).toHaveBeenCalledWith(1, undefined, expect.any(String)));
    expect(logs.warn).not.toHaveBeenCalled();
  } finally { logs.restore(); }
});
