/**
 * Server function analysis and generation, checked against the old compiler's
 * (`@memoized-dom/compiler`), which is the oracle for this contract: the server package routes by
 * the same metadata, and clients call the same endpoints.
 */
import { describe, expect, it } from 'bun:test';
import {
  analyzeServerFunctionModule,
  generateServerFunctionClient,
  generateServerFunctionDeclarations,
} from '@memoized-dom/compiler';
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

describe('server functions', () => {
  for (const [moduleId, source] of Object.entries(MODULES)) {
    it(`analyze ${moduleId} as the old compiler does, and generate the same client facade`, () => {
      const expected = analyzeServerFunctionModule(source, { moduleId, functionsRoot: 'server/functions' });
      const actual = analyzeServerFunctions(moduleId, source);
      expect(actual).toEqual(expected);
      expect(serverFunctionClient(actual)).toBe(generateServerFunctionClient(expected));
    });
  }

  it('declare the barrel as the old compiler does', () => {
    const modules = Object.entries(MODULES).map(([moduleId, source]) => analyzeServerFunctions(moduleId, source));
    const resolve = (moduleId: string) => `../${moduleId.replace(/\.tsx?$/, '.js')}`;
    expect(serverFunctionDeclarations(modules, resolve)).toBe(
      generateServerFunctionDeclarations(modules, { resolveImplementation: resolve }),
    );
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
  ];
  for (const [source, message] of ERRORS) {
    it(`report ${message}`, () => {
      const moduleId = 'server/functions/bad.ts';
      expect(() => analyzeServerFunctionModule(source, { moduleId, functionsRoot: 'server/functions' })).toThrow(message);
      expect(() => analyzeServerFunctions(moduleId, source)).toThrow(message);
    });
  }

  it('report a name two modules export, as the barrel is flat', () => {
    const one = analyzeServerFunctions('server/functions/one.ts', 'export const same = define.function({ async get() {} });');
    const two = analyzeServerFunctions('server/functions/two.ts', 'export const same = define.function({ async get() {} });');
    expect(() => serverFunctionDeclarations([one, two], (id) => id)).toThrow("'same' is exported by both");
  });
});
