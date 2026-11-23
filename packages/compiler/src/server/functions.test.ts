/**
 * Server function analysis and generation: the contract the server package routes by and clients
 * call (`wiki/compiler/server.md`). Until the old compiler was deleted (2026-11-17) each module was
 * compared with its analysis; these expectations are what both agreed on then.
 */
import { describe, expect, it } from 'bun:test';
import { analyzeServerFunctions, serverFunctionModuleName } from './functions';
import { serverFunctionClient, serverFunctionDeclarations } from './generate';

const MODULES: Record<string, string> = {
  'server/functions/users.ts': `
    import { define } from '../define';
    export const getUser = define.function({
      async get({ state, services }, id: string, page: number = 1, active?: boolean, tags: string[] = [], role?: 'admin' | 'user' | undefined) {
        return services.users.find(id, page, active, tags, role);
      },
    });
    export const createUser = define.function({
      middleware: [requireAdmin],
      async post({ services }, name: string, email: string) { return services.users.create(name, email); },
    });
    export const removeUser = define.function({
      input: removeUserInput,
      async delete({ services }, input) { return services.users.remove(input.id); },
    });
    export const middleware = [audit];
  `,
  'server/functions/stories/feed.ts': `
    export const getStories = define.function({ async get() { return loadStories(); } });
    export const watchStories = define.function({ live: true, async get(_context, topic = 'news') { return stories(topic); } });
    export const streamLog = define.function({ async *get(_context, since: number) { yield since; } });
    export const putStory = define.function({ updates: [getStories], async put(_context, story) { return story; } });
    export const searchSchema = define.function({ input: search, async get(_context, query) { return query; } });
  `,
  'server/functions/panel.tsx': `
    export const panel = define.function({ async get(_context, id: string) { return <section>{id}</section>; } });
    export const savePanel = define.function({ async post(_context, text) { return <p>{text}</p>; } });
  `,
  'server/functions/_middleware.ts': 'export const middleware = [logRequests];',
};

const analyzed = (moduleId: string) => analyzeServerFunctions(moduleId, MODULES[moduleId]!);

describe('server functions', () => {
  it('give each function its method, endpoint and parameters, with query types for a GET', () => {
    const users = analyzed('server/functions/users.ts');
    expect(users.moduleName).toBe('users');
    expect(users.middlewareExport).toBe(true);
    expect(users.functions).toEqual([
      { exported: 'createUser', local: 'createUser', method: 'POST', path: '/_fn/users/createUser', schemaInput: false,
        parameters: [{ name: 'name', optional: false }, { name: 'email', optional: false }] },
      { exported: 'getUser', local: 'getUser', method: 'GET', path: '/_fn/users/getUser', schemaInput: false,
        parameters: [
          { name: 'id', optional: false, queryKind: 'string' },
          { name: 'page', optional: true, queryKind: 'number' },
          { name: 'active', optional: true, queryKind: 'boolean' },
          { name: 'tags', optional: true, queryKind: 'string[]' },
          { name: 'role', optional: true, queryKind: 'string' },
        ] },
      { exported: 'removeUser', local: 'removeUser', method: 'DELETE', path: '/_fn/users/removeUser', schemaInput: true,
        parameters: [{ name: 'input', optional: false }] },
    ]);
  });

  it('mark live, generator and schema functions, below a nested folder\'s endpoint', () => {
    const feed = analyzed('server/functions/stories/feed.ts');
    expect(feed.moduleName).toBe('stories/feed');
    const byName = Object.fromEntries(feed.functions.map((fn) => [fn.exported, fn]));
    expect(byName.getStories).toMatchObject({ method: 'GET', path: '/_fn/stories/feed/getStories', parameters: [] });
    expect(byName.watchStories).toMatchObject({ live: true, parameters: [{ name: 'topic', optional: true, queryKind: 'string' }] });
    expect(byName.streamLog).toMatchObject({ generator: true, parameters: [{ name: 'since', optional: false, queryKind: 'number' }] });
    expect(byName.putStory).toMatchObject({ method: 'PUT', parameters: [{ name: 'story', optional: false }] });
    expect(byName.searchSchema).toMatchObject({ method: 'GET', schemaInput: true });
  });

  it('mark a function returning markup as a page, and a middleware module as having none', () => {
    expect(analyzed('server/functions/panel.tsx').functions.map((fn) => [fn.exported, fn.page])).toEqual([['panel', true], ['savePanel', true]]);
    expect(analyzed('server/functions/_middleware.ts')).toMatchObject({ moduleName: '_middleware', middlewareExport: true, functions: [] });
  });

  it('generate facades that call each endpoint: a GET by its query, a body otherwise, a stream for live and generators', () => {
    expect(serverFunctionClient(analyzed('server/functions/users.ts'))).toBe([
      'import { $fetch as __mmd_fetch } from "@memoized-dom/data";',
      'export function createUser(name, email) { return __mmd_fetch("/_fn/users/createUser", { method: "POST", body: { name, email } }); }',
      'export function getUser(id, page, active, tags, role) { return __mmd_fetch("/_fn/users/getUser", { query: { id, page, active, tags, role } }); }',
      'export function removeUser(input) { return __mmd_fetch("/_fn/users/removeUser", { method: "DELETE", body: JSON.stringify(input), headers: { \'content-type\': \'application/json\' } }); }',
      '',
    ].join('\n'));
    const feed = serverFunctionClient(analyzed('server/functions/stories/feed.ts'));
    expect(feed).toContain('import { createStreamingSource as __mmd_stream } from "@memoized-dom/data/internal";');
    expect(feed).toContain('export function searchSchema(input) { return __mmd_fetch("/_fn/stories/feed/searchSchema", { query: { input: JSON.stringify(input) } }); }');
    expect(feed).toContain('export function streamLog(since) { return __mmd_stream("/_fn/stories/feed/streamLog", { query: { since } }, "generator"); }');
    expect(feed).toContain('export function watchStories(topic) { return __mmd_stream("/_fn/stories/feed/watchStories", { query: { topic } }, "live"); }');
  });

  it('declare the barrel: a GET returns a resolved value, any other method a promise', () => {
    const declarations = serverFunctionDeclarations([analyzed('server/functions/users.ts')], (moduleId) => `../${moduleId.replace(/\.tsx?$/, '.js')}`);
    expect(declarations).toContain('import type * as __mmd_impl_0 from "../server/functions/users.js";');
    expect(declarations).toContain('export declare function getUser(...args: ServerFunctionArguments<typeof __mmd_impl_0.getUser>): ResolvedValue<__mmdClientValue<Awaited<ServerFunctionResult<typeof __mmd_impl_0.getUser>>>>;');
    expect(declarations).toContain('export declare function createUser(...args: ServerFunctionArguments<typeof __mmd_impl_0.createUser>): Promise<__mmdClientValue<Awaited<ServerFunctionResult<typeof __mmd_impl_0.createUser>>>>;');
  });

  it('name modules by their path in the functions folder', () => {
    expect(serverFunctionModuleName('./server/functions/a b/c.ts')).toBe('a%20b/c');
    expect(serverFunctionModuleName('server/functions/_middleware.ts')).toBe('_middleware');
    expect(serverFunctionModuleName('./backend/functions/x.ts', 'backend/functions')).toBe('x');
    expect(() => serverFunctionModuleName('./src/x.ts')).toThrow("is outside 'server/functions/'");
  });

  const ERRORS: Array<[string, string]> = [
    ['export const helper = 1;', "export 'helper' must be created by define.function()"],
    ['export default define.function({ async get() {} });', 'default exports cannot cross the client boundary'],
    ["export { a } from './a';", 're-export server functions through a local named binding'],
    ['export const a = define.function({ get() { return 1; } });', "'a' handler must be async"],
    ['export const a = define.function({ async get() {}, async post() {} });', 'exactly one HTTP method'],
    ['export const a = define.function({ async fetch() {} });', "unsupported define.function() field 'fetch'"],
    ['export const a = define.function({ ...base });', 'fields must be explicit'],
    ['export const a = define.function(options);', 'requires an inline object definition'],
    ['export const a = define.function({ get: handler });', "'get' requires an inline handler"],
    ['export const a = define.function({ async get(_c, { id }) {} });', 'parameters must be named identifiers'],
    ['export const a = define.function({ async get(_c, ids: { id: string }) {} });', "parameter 'ids' must use one string, number, or boolean query type"],
    ['export const a = define.function({ input: s, async get(_c, a, b) {} });', 'at most one schema-owned input'],
    ['export const a = define.function({ live: true, async post() {} });', 'live requires an ordinary GET'],
    ["export const a = define.function({ async get() {}, refresh: '30s' });", 'refresh needs a live GET'],
    ["export const a = define.function({ async websocket() {}, live: () => ['a'], refresh: '30s' });", 'refresh needs a live GET'],
    ["export const a = define.function({ live: (c, id) => ['a', id], async get(_c, id: string) {} });",
      "move 'live' after 'get'"],
    ["export const a = define.function({ updates: (c, id) => ['a', id], async post(_c, id: string) {} });",
      "move 'updates' after 'post'"],
  ];
  for (const [source, message] of ERRORS) {
    it(`report ${message}`, () => {
      expect(() => analyzeServerFunctions('server/functions/bad.ts', source)).toThrow(message);
    });
  }

  // TypeScript types these correctly in any order (packages/server/tests/define.types.ts).
  it('accept live and updates before the handler when their arguments already have types', () => {
    for (const source of [
      "export const a = define.function({ live: context => ['a', context.state.user], async get(_c, id: string) {} });",
      "export const a = define.function({ live: (c, id: string) => ['a', id], async get(_c, id: string) {} });",
      "export const a = define.function({ input: s, live: (c, input) => ['a', input.id], async get(_c, input) {} });",
      "export const a = define.function({ live: keyOf, async get(_c, id: string) {} });",
      "export const a = define.function({ async get(_c, id: string) {}, live: (c, id) => ['a', id] });",
      "export const a = define.function({ async get() {}, live: () => ['a'], refresh: '30s' });",
    ]) {
      expect(() => analyzeServerFunctions('server/functions/good.ts', source)).not.toThrow();
    }
  });

  it('report a name two modules export, as the barrel is flat', () => {
    const one = analyzeServerFunctions('server/functions/one.ts', 'export const same = define.function({ async get() {} });');
    const two = analyzeServerFunctions('server/functions/two.ts', 'export const same = define.function({ async get() {} });');
    expect(() => serverFunctionDeclarations([one, two], (id) => id)).toThrow("'same' is exported by both");
  });
});
