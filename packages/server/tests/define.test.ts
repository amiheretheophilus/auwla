import { describe, expect, expectTypeOf, it, vi } from 'bun:test';
import type { StandardSchemaV1 } from '@memoized-dom/data';
import {
  createDefine,
  serve,
  type ServerFunctionArguments,
} from '../src';

describe('createDefine', () => {
  it('defines no-input operations and validates HTTP method ownership', async () => {
    const define = createDefine();
    const stories = define.function({ async get() { return ['story']; } });
    expect(stories.method).toBe('GET');
    expect(await stories.handler({
      request: new Request('https://app.test'), url: new URL('https://app.test'),
      params: {}, state: {}, services: {}, platform: undefined,
    })).toEqual(['story']);
    // @ts-expect-error Intentionally bypass the definition shape to verify runtime validation.
    expect(() => define.function({})).toThrow('exactly one HTTP method');
    // @ts-expect-error Intentionally invalid multi-method definition.
    expect(() => define.function({ async get() {}, async post() {} })).toThrow('exactly one HTTP method');
  });
  it('shares request state through middleware and handlers', async () => {
    interface State { requestId: string; user?: string }
    const define = createDefine<State>();
    const session = define.middleware(async ({ state }, next) => {
      state.user = 'Ada';
      return next();
    });
    const app = serve({
      define,
      state: () => ({ requestId: 'request-1' }),
    });
    app.get('/account', session, ({ state }) => ({ ...state }));

    await expect((await app.fetch(new Request('https://app.test/account'))).json())
      .resolves.toEqual({ requestId: 'request-1', user: 'Ada' });
  });

  it('resolves service dependencies once per application', async () => {
    interface Services {
      database: { name: string };
      mailer: { database: string };
    }
    const define = createDefine<Record<string, never>, unknown, Services>();
    const createDatabase = vi.fn(async () => ({ name: 'primary' }));
    const database = define.service('database', createDatabase);
    define.service('mailer', {
      dependencies: { database },
      create: ({ database }) => ({ database: database.name }),
    });
    const app = serve({ define });
    app.get('/services', ({ services }) => ({
      database: services.database.name,
      mailer: services.mailer.database,
    }));

    const responses = await Promise.all([
      app.fetch(new Request('https://app.test/services')),
      app.fetch(new Request('https://app.test/services')),
    ]);
    await expect(Promise.all(responses.map(response => response.json())))
      .resolves.toEqual([
        { database: 'primary', mailer: 'primary' },
        { database: 'primary', mailer: 'primary' },
      ]);
    expect(createDatabase).toHaveBeenCalledTimes(1);
  });

  it('retains targeted function middleware and the injected handler context', async () => {
    interface State { user?: string }
    const define = createDefine<State>();
    const authenticated = define.middleware(async ({ state }, next) => {
      state.user = 'Ada';
      return next();
    });
    const getUser = define.function({
      middleware: [authenticated],
      get: async ({ state }, id: number) => ({ id, user: state.user }),
    });

    expect(getUser.method).toBe('GET');
    expect(getUser.middleware).toEqual([authenticated]);
    await expect(getUser.handler({
      request: new Request('https://app.test'),
      url: new URL('https://app.test'),
      params: {},
      state: { user: 'Ada' },
      platform: undefined,
      services: {},
    }, 7)).resolves.toEqual({ id: 7, user: 'Ada' });
  });

  it('uses schema input for the client argument and schema output for the handler', () => {
    const define = createDefine();
    const input: StandardSchemaV1<{ id: string }, { id: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          return { value: { id: Number((value as { id: string }).id) } };
        },
      },
    };
    const story = define.function({
      input,
      async get(_context, value) {
        expectTypeOf(value).toEqualTypeOf<{ id: number }>();
        return value.id;
      },
    });

    expectTypeOf<ServerFunctionArguments<typeof story>>()
      .toEqualTypeOf<readonly [input: { id: string }]>();
  });

  it('retries failed service startup and keeps application caches separate', async () => {
    const define = createDefine<Record<string, never>, unknown, { database: { generation: number } }>();
    let calls = 0;
    define.service('database', async () => {
      calls++;
      if (calls === 1) throw new Error('Database unavailable');
      return { generation: calls };
    });
    const app = serve({ define });
    app.get('/database', ({ services }) => services.database);
    const request = () => new Request('https://app.test/database');
    await expect(app.fetch(request())).rejects.toThrow('Database unavailable');
    expect(await (await app.fetch(request())).json()).toEqual({ generation: 2 });
    expect(await (await app.fetch(request())).json()).toEqual({ generation: 2 });

    const other = serve({ define });
    other.get('/database', ({ services }) => services.database);
    expect(await (await other.fetch(request())).json()).toEqual({ generation: 3 });
  });
});
