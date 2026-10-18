// Runs with Bun globals; no DOM preload.
import { describe, expect, expectTypeOf, it, vi } from 'bun:test';
import { json as respondJson, type JsonResponse } from '../src';
import {
  createServerFunctionRoutes,
  createServerRouter,
  invokeRoutedPreparation,
  type ServerMiddleware,
} from '../src/http-router';
import { registerRoutedPreparation } from '@memoized-dom/router/internal';
import type { StandardSchemaV1 } from '@memoized-dom/data';

async function json(response: Response): Promise<unknown> {
  return response.json();
}

describe('server HTTP router', () => {
  it('validates decoded GET input after middleware and passes transformed arguments', async () => {
    const order: string[] = [];
    const schema: StandardSchemaV1<unknown, Record<string, unknown>> = {
      '~standard': {
        version: 1, vendor: 'test',
        async validate(input) {
          order.push('validation');
          const value = input as { id: number; label?: string };
          const id = value.id;
          return id > 0
            ? { value: { id, label: value.label ?? 'default' } }
            : { issues: [{ message: 'ID must be positive', path: ['id'] }] };
        },
      },
    };
    const handler = vi.fn((_context: unknown, ...args: unknown[]) => {
      order.push('handler');
      return { args };
    });
    const router = createServerRouter({ routes: createServerFunctionRoutes([{
      id: 'stories/story', method: 'GET', path: '/_fn/stories/story',
      schemaInput: true,
      parameters: [{ name: 'input', optional: false }],
      middleware: [async (_context, next) => { order.push('middleware'); return next(); }],
      input: schema, handler,
    }]) });
    const request = (id: number) => new Request('https://app.test/_fn/stories/story?input=' + encodeURIComponent(JSON.stringify({ id })));
    const response = await router.fetch(request(42));
    expect(await response.json()).toEqual({ args: [{ id: 42, label: 'default' }] });
    expect(order).toEqual(['middleware', 'validation', 'handler']);
    const invalid = await router.fetch(request(-1));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'invalid_server_function_input', issues: [{ message: 'ID must be positive' }] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('preserves scalar schema inputs for GET and mutation handlers', async () => {
    const schema: StandardSchemaV1<number, string> = {
      '~standard': {
        version: 1, vendor: 'test',
        validate: value => typeof value === 'number'
          ? { value: String(value) }
          : { issues: [{ message: 'Expected number' }] },
      },
    };
    for (const method of ['GET', 'POST'] as const) {
      const router = createServerRouter({ routes: createServerFunctionRoutes([{
        id: 'scalar', method, path: '/_fn/scalar', schemaInput: true,
        parameters: [{ name: 'input', optional: false }], input: schema,
        handler: (_context, input) => ({ input, type: typeof input }),
      }]) });
      const request = method === 'GET'
        ? new Request('https://app.test/_fn/scalar?input=42')
        : new Request('https://app.test/_fn/scalar', { method, body: '42' });
      expect(await (await router.fetch(request)).json()).toEqual({ input: '42', type: 'string' });
      if (method === 'GET') {
        for (const query of ['', '?input=oops', '?input=1&input=2', '?input=1&extra=2']) {
          expect((await router.fetch(new Request('https://app.test/_fn/scalar' + query))).status).toBe(400);
        }
      }
    }
  });

  it('validates mutation values and allows auth middleware to short-circuit validation', async () => {
    const validate = vi.fn((input: unknown) => {
      const value = input as { id: unknown };
      return typeof value.id === 'number'
        ? { value }
        : { issues: [{ message: 'Expected a number' }] };
    });
    const handler = vi.fn(() => ({ ok: true }));
    const router = createServerRouter({ routes: createServerFunctionRoutes([{
      id: 'stories/vote', method: 'POST', path: '/_fn/stories/vote',
      schemaInput: true,
      parameters: [{ name: 'input', optional: false }],
      middleware: [(context, next) => context.request.headers.has('authorization')
        ? next() : new Response(null, { status: 401 })],
      input: { '~standard': { version: 1, vendor: 'test', validate } }, handler,
    }]) });
    const request = (id: unknown, authenticated: boolean) => new Request('https://app.test/_fn/stories/vote', {
      method: 'POST', body: JSON.stringify({ id }),
      headers: authenticated ? { authorization: 'user' } : {},
    });
    expect((await router.fetch(request(42, false))).status).toBe(401);
    expect(validate).not.toHaveBeenCalled();
    expect((await router.fetch(request('wrong', true))).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect((await router.fetch(request(42, true))).status).toBe(200);
    expect(handler.mock.calls[0]?.slice(1)).toEqual([{ id: 42 }]);
  });

  it('keeps native JSON date serialization without reconstructing values', async () => {
    const response = respondJson({ createdAt: new Date('2026-10-02T12:00:00.000Z'), label: '2026-10-02' });
    expect(await response.json()).toEqual({ createdAt: '2026-10-02T12:00:00.000Z', label: '2026-10-02' });
  });
  it('passes through native Response status, headers, and body from server functions', async () => {
    const result = respondJson({ userId: '42' }, {
      status: 201,
      headers: { 'set-cookie': 'session=abc; HttpOnly; Path=/' },
    });
    expectTypeOf(result).toEqualTypeOf<JsonResponse<{ userId: string }>>();
    expect(result).toBeInstanceOf(Response);
    const router = createServerRouter({
      routes: createServerFunctionRoutes([{
        id: 'auth/postLogin',
        method: 'POST',
        path: '/_fn/auth/postLogin',
        parameters: [],
        handler: () => result,
      }]),
    });
    const response = await router.fetch(new Request(
      'https://app.test/_fn/auth/postLogin',
      { method: 'POST' },
    ));

    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toBe('session=abc; HttpOnly; Path=/');
    expect(await response.json()).toEqual({ userId: '42' });
  });

  it('uses the same JSON helper in ordinary routes and middleware', async () => {
    const router = createServerRouter({
      routes: [{
        method: 'GET',
        path: '/health',
        handler: () => respondJson({ ok: true }, { status: 202 }),
      }, {
        method: 'GET',
        path: '/protected',
        middleware: [() => respondJson({ error: 'forbidden' }, { status: 403 })],
        handler: () => respondJson({ secret: true }),
      }],
    });

    const health = await router.fetch(new Request('https://app.test/health'));
    expect(health.status).toBe(202);
    expect(await health.json()).toEqual({ ok: true });

    const denied = await router.fetch(new Request('https://app.test/protected'));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden' });
  });

  it('uses a returned non-2xx Response instead of the generic error handler', async () => {
    const onError = vi.fn(() => new Response('Internal error', { status: 500 }));
    const router = createServerRouter({
      routes: createServerFunctionRoutes([{
        id: 'auth/postLogin',
        method: 'POST',
        path: '/_fn/auth/postLogin',
        parameters: [],
        handler: () => Response.json({ error: 'invalid_credentials' }, { status: 401 }),
      }]),
      onError,
    });

    const response = await router.fetch(new Request(
      'https://app.test/_fn/auth/postLogin',
      { method: 'POST' },
    ));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid_credentials' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('logs an unhandled failure on the server when no onError is configured', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const router = createServerRouter({
        routes: createServerFunctionRoutes([{
          id: 'boom', method: 'GET', path: '/_fn/boom', parameters: [],
          handler: () => { throw new Error('database unreachable'); },
        }]),
      });
      const response = await router.fetch(new Request('https://app.test/_fn/boom'));
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Internal Server Error');
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0]![0])).toContain('GET /_fn/boom failed');
      expect(String(logged.mock.calls[0]![1])).toContain('database unreachable');
    } finally { logged.mockRestore(); }
  });

  // A server render that finishes cancels the nested calls it no longer needs.
  it('does not log a request its caller cancelled', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const router = createServerRouter({
        routes: createServerFunctionRoutes([{
          id: 'slow', method: 'GET', path: '/_fn/slow', parameters: [],
          handler: () => { throw new DOMException('The operation was aborted.', 'AbortError'); },
        }]),
      });
      const controller = new AbortController();
      controller.abort();
      await router.fetch(new Request('https://app.test/_fn/slow', { signal: controller.signal }));
      expect(logged).not.toHaveBeenCalled();
    } finally { logged.mockRestore(); }
  });

  it('attaches request-owned server capabilities to routed preparation', async () => {
    registerRoutedPreparation({
      id: 'server-report-preparation',
      server: true,
      prepare: context => {
        const services = context.services as { report: string };
        const state = context.state as { user: string };
        context.routeState.visits = Number(context.routeState.visits ?? 0) + 1;
        context.routeState.serverOnly = () => 'not transported';
        return {
          report: services.report,
          user: state.user,
          id: context.params.reportId,
          method: context.request.method,
        };
      },
    });
    const outcome = await invokeRoutedPreparation({
      id: 'server-report-preparation',
      href: 'https://app.test/reports/42',
      params: { reportId: '42' },
      state: { visits: 2 },
    }, {
      request: new Request('https://app.test/_memoized/routed', {
        method: 'POST',
      }),
      state: { user: 'Ada' },
      services: { report: 'Quarterly' },
    });

    expect(outcome).toEqual({
      kind: 'data',
      data: {
        report: 'Quarterly',
        user: 'Ada',
        id: '42',
        method: 'POST',
      },
      state: { visits: 3 },
    });
  });

  it('mounts named HTTP functions as strict middleware-aware routes', async () => {
    const calls: unknown[][] = [];
    const routeMiddleware = vi.fn(async (_context, next) => {
      const response = await next();
      response.headers.set('x-function-middleware', 'yes');
      return response;
    });
    const routes = createServerFunctionRoutes([{
      id: 'stories/getStory',
      method: 'GET',
      path: '/_fn/stories/getStory',
      parameters: [
        { name: 'id', optional: false, queryKind: 'number' },
        { name: 'preview', optional: true, queryKind: 'boolean' },
        { name: 'tags', optional: false, queryKind: 'string[]' },
      ],
      middleware: [routeMiddleware],
      handler: (_context, ...args) => {
        calls.push(args);
        return { args };
      },
    }]);
    const router = createServerRouter({ routes });

    const response = await router.fetch(new Request(
      'https://app.test/_fn/stories/getStory?id=42&preview=true&tags=a&tags=b',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-function-middleware')).toBe('yes');
    expect(await json(response)).toEqual({ args: [42, true, ['a', 'b']] });
    expect(calls).toEqual([[42, true, ['a', 'b']]]);
    expect(routeMiddleware).toHaveBeenCalledTimes(1);
  });

  it('decodes mutation bodies and reports malformed endpoint input as 400', async () => {
    const handler = vi.fn((_context: unknown, id: unknown, reason: unknown) => ({ id, reason }));
    const router = createServerRouter({
      routes: createServerFunctionRoutes([{
        id: 'stories/deleteStory',
        method: 'DELETE',
        path: '/_fn/stories/deleteStory',
        parameters: [
          { name: 'id', optional: false },
          { name: 'reason', optional: true },
        ],
        handler,
      }]),
    });

    const success = await router.fetch(new Request(
      'https://app.test/_fn/stories/deleteStory',
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 7 }),
      },
    ));
    expect(await json(success)).toEqual({ id: 7 });
    expect(handler.mock.calls[0]?.slice(1)).toEqual([7, undefined]);

    const malformed = await router.fetch(new Request(
      'https://app.test/_fn/stories/deleteStory',
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'duplicate', extra: true }),
      },
    ));
    expect(malformed.status).toBe(400);
    expect(await json(malformed)).toEqual({
      error: 'invalid_server_function_input',
      message: "Unknown request body field 'extra'",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps the /_fn namespace exclusive to generated server-function routes', () => {
    expect(() => createServerRouter({
      routes: [{
        method: 'GET',
        path: '/_fn/stories/getStory',
        handler: () => undefined,
      }],
    })).toThrow("reserved server-function namespace '/_fn/*'");
  });

  it('dispatches static and parameterized routes by method', async () => {
    const router = createServerRouter({
      routes: [
        {
          method: 'GET',
          path: '/health',
          handler: () => 'ok',
        },
        {
          method: 'GET',
          path: '/users/:id',
          handler: (context) => ({
            id: context.params.id,
            query: context.url.searchParams.get('view'),
          }),
        },
        {
          method: 'POST',
          path: '/users/:id',
          handler: (context) => Response.json({
            id: context.params.id,
            method: context.request.method,
          }),
        },
      ],
    });

    const health = await router.fetch(new Request('https://app.test/health'));
    expect(await health.text()).toBe('ok');
    expect(health.headers.get('content-type')).toBe('text/plain; charset=utf-8');

    const user = await router.fetch(
      new Request('https://app.test/users/a%20b?view=full'),
    );
    expect(await json(user)).toEqual({ id: 'a b', query: 'full' });

    const created = await router.fetch(new Request('https://app.test/users/42', {
      method: 'POST',
    }));
    expect(await json(created)).toEqual({ id: '42', method: 'POST' });
  });

  it('implements HEAD fallback, automatic OPTIONS, and method diagnostics', async () => {
    const get = vi.fn(() => new Response('body', {
      headers: { 'x-route': 'get' },
    }));
    const router = createServerRouter({
      routes: [
        { method: 'GET', path: '/items', handler: get },
        { method: 'POST', path: '/items', handler: () => ({ created: true }) },
      ],
    });

    const head = await router.fetch(new Request('https://app.test/items', {
      method: 'HEAD',
    }));
    expect(head.status).toBe(200);
    expect(head.headers.get('x-route')).toBe('get');
    expect(await head.text()).toBe('');
    expect(get).toHaveBeenCalledTimes(1);

    const options = await router.fetch(new Request('https://app.test/items', {
      method: 'OPTIONS',
    }));
    expect(options.status).toBe(204);
    expect(options.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');

    const rejected = await router.fetch(new Request('https://app.test/items', {
      method: 'PATCH',
    }));
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
  });

  it('composes global, prefix, and route middleware as an onion', async () => {
    interface Locals { user?: string; }
    const events: string[] = [];
    const layer = (name: string): ServerMiddleware<Locals> =>
      async (_context, next) => {
        events.push(`${name}:in`);
        const response = await next();
        events.push(`${name}:out`);
        response.headers.set(`x-${name}`, 'yes');
        return response;
      };
    const router = createServerRouter<Locals>({
      createState: () => ({}),
      middleware: [layer('global')],
      groups: [
        { path: '/api/*', middleware: [layer('api')] },
        {
          path: '/api/admin/*',
          middleware: [
            async (context, next) => {
              context.state.user = 'Ada';
              return layer('admin')(context, next);
            },
          ],
        },
      ],
      routes: [{
        method: 'GET',
        path: '/api/admin/users/:id',
        middleware: [layer('route')],
        handler: (context) => {
          events.push('handler');
          return { id: context.params.id, user: context.state.user };
        },
      }],
    });

    const response = await router.fetch(
      new Request('https://app.test/api/admin/users/1'),
    );

    expect(await json(response)).toEqual({ id: '1', user: 'Ada' });
    expect(events).toEqual([
      'global:in',
      'api:in',
      'admin:in',
      'route:in',
      'handler',
      'route:out',
      'admin:out',
      'api:out',
      'global:out',
    ]);
    expect(response.headers.get('x-global')).toBe('yes');
    expect(response.headers.get('x-api')).toBe('yes');
    expect(response.headers.get('x-admin')).toBe('yes');
    expect(response.headers.get('x-route')).toBe('yes');
  });

  it('runs matching page middleware before the fallback handler', async () => {
    const router = createServerRouter<{ authenticated: boolean }>({
      createState: () => ({ authenticated: false }),
      groups: [{
        path: '/admin/*',
        middleware: [async (context, next) => context.state.authenticated
          ? next()
          : new Response('Unauthorized', { status: 401 })],
      }],
      routes: [],
      fallback: (context) => `page:${context.url.pathname}`,
    });

    const protectedPage = await router.fetch(
      new Request('https://app.test/admin/dashboard'),
    );
    expect(protectedPage.status).toBe(401);

    const page = await router.fetch(new Request('https://app.test/about'));
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('page:/about');
  });

  it('reuses request state and platform for derived in-memory dispatch', async () => {
    interface Locals { trace: string; }
    interface Platform { region: string; }
    const router = createServerRouter<Locals, Platform>({
      createState: () => ({ trace: 'external' }),
      createPlatform: () => ({ region: 'default' }),
      routes: [{
        method: 'GET',
        path: '/context',
        handler: (context) => ({
          trace: context.state.trace,
          region: context.platform?.region,
        }),
      }],
    });

    const response = await router.dispatch(
      new Request('https://app.test/context'),
      {
        state: { trace: 'parent-request' },
        platform: { region: 'edge' },
      },
    );
    expect(await json(response)).toEqual({
      trace: 'parent-request',
      region: 'edge',
    });
  });

  it('routes failures through one error boundary', async () => {
    const router = createServerRouter({
      routes: [{
        method: 'GET',
        path: '/broken',
        handler: () => {
          throw new Error('database unavailable');
        },
      }],
      onError: (error, context) => Response.json({
        message: error instanceof Error ? error.message : String(error),
        path: context.url.pathname,
      }, { status: 503 }),
    });

    const response = await router.fetch(new Request('https://app.test/broken'));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({
      message: 'database unavailable',
      path: '/broken',
    });
  });

  it('rejects ambiguous method tables during startup', () => {
    expect(() => createServerRouter({
      routes: [
        { method: 'GET', path: '/users/:id', handler: () => undefined },
        { method: 'get', path: '/users/:name', handler: () => undefined },
      ],
    })).toThrow('Invalid GET route table');
  });
});
