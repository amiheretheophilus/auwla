import { waitFor, type FetchStub } from '../../../test-support/helpers';
import { describe, expect, it, vi } from 'bun:test';
import { createDataRuntime, RequestError } from '../src';
import type { FetchResource } from '../src';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function settled<T>(resource: FetchResource<T>): Promise<void> {
  await waitFor(() => expect(resource.pending).toBe(false));
}

describe('request identity and errors', () => {
  it('retains the status and JSON body of a non-2xx response', async () => {
    const runtime = createDataRuntime({
      fetch: (async () => json({ error: 'invalid_credentials' }, 401)) as FetchStub,
    });
    const resource = runtime.$fetch('/_fn/auth/postLogin');
    await settled(resource);

    expect(resource.error).toMatchObject({
      kind: 'http',
      status: 401,
      data: { error: 'invalid_credentials' },
    });
  });

  // `json({ message: '…' }, { status: 401 })` from a server function is an
  // answer for the person: a form shows it instead of "status 401".
  it('uses the message a non-2xx JSON body explains itself with', async () => {
    const explained = createDataRuntime({
      fetch: (async () => json({ message: 'Email or password is invalid' }, 401)) as FetchStub,
    });
    const login = explained.$fetch('/_fn/auth/postLogin');
    await settled(login);
    expect(login.error?.message).toBe('Email or password is invalid');
    expect(login.error).toMatchObject({ status: 401, data: { message: 'Email or password is invalid' } });

    const bare = createDataRuntime({ fetch: (async () => json({ error: 'nope' }, 403)) as FetchStub });
    const other = bare.$fetch('/_fn/auth/other');
    await settled(other);
    expect(other.error?.message).toBe('Request failed with status 403');
  });

  it('classifies a malformed non-success body as an HTTP failure', async () => {
    const runtime = createDataRuntime({
      fetch: (async () => new Response('{broken', {
        status: 500,
        statusText: 'Server Error',
        headers: { 'content-type': 'application/json' },
      })) as FetchStub,
    });
    const resource = runtime.$fetch('/broken');

    await settled(resource);

    expect(resource.error).toBeInstanceOf(RequestError);
    expect(resource.error).toMatchObject({
      kind: 'http',
      status: 500,
      statusText: 'Server Error',
    });
  });

  it('does not wrap an abort during response decoding', async () => {
    const response = {
      status: 200,
      statusText: 'OK',
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.reject(new DOMException('Aborted', 'AbortError')),
      text: () => Promise.resolve(''),
    } as unknown as Response;
    const runtime = createDataRuntime({ fetch: (async () => response) as FetchStub });
    const resource = runtime.$fetch('/aborted');

    await waitFor(() => expect(resource.pending).toBe(false));

    expect(resource.status).toBe('idle');
    expect(resource.error).toBeNull();
  });

  it('strips fragments and shares equivalent absolute request identities', async () => {
    const fetcher = vi.fn(async () => json(['shared']));
    const runtime = createDataRuntime({
      fetch: fetcher as FetchStub,
      baseURL: 'https://example.test/app/',
    });

    const first = runtime.$fetch<string[]>('/api/users#first');
    const second = runtime.$fetch<string[]>('https://example.test/api/users#second');
    await settled(first);
    await settled(second);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/api/users',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('snapshots headers before request identity and execution', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer first');
      return json({ ok: true });
    });
    const headers = new Headers({ authorization: 'Bearer first' });
    const runtime = createDataRuntime({ fetch: fetcher as FetchStub });
    const resource = runtime.$fetch('/profile', { headers });
    headers.set('authorization', 'Bearer changed');

    await settled(resource);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
