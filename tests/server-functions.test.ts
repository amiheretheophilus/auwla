import { describe, expect, it } from 'bun:test';
import {
  analyzeServerFunctionModule,
  compileModules,
  generateServerFunctionClient,
  generateServerFunctionDeclarations,
  generateServerFunctionImplementation,
  serverFunctionModuleName,
} from '@memoized-dom/compiler';
import { utilsPackageArtifacts } from '../test-support/package-artifacts';

describe('defined HTTP server functions', () => {
  it('generates live and generator facades and preserves multiple optimistic source holders', () => {
    const metadata = analyzeServerFunctionModule(`
      export const getNotes = define.function({ live: (_ctx, id) => ['notes', id], async get(_ctx, id: string) { return []; } });
      export const answer = define.function({ async *post(_ctx, prompt: string) { yield prompt; return prompt; } });
      export const postTextFirst = define.function({
        async post(_ctx, text: string, expeditionId: string) { return { text, expeditionId }; },
        updates: (_ctx, _message, id) => ['notes', id],
      });
    `, { moduleId: '/app/server/functions/notes.ts' });
    expect(metadata.functions.find(fn => fn.exported === 'getNotes')?.live).toBe(true);
    expect(metadata.functions.find(fn => fn.exported === 'answer')?.generator).toBe(true);
    const facade = generateServerFunctionClient(metadata);
    expect(facade).toContain('createStreamingSource');
    expect(metadata.functions.find(fn => fn.exported === 'postTextFirst')?.parameters.map(parameter => parameter.name))
      .toEqual(['text', 'expeditionId']);
    expect(facade).toContain('export function postTextFirst(text, expeditionId)');
    expect(facade).toContain('body: { text, expeditionId }');
    const output = compileModules({
      './functions.ts': facade,
      './App.tsx': `import { getNotes } from './functions'; import { optimistic as update } from '@memoized-dom/utils';
        export function App() {
          const notes = getNotes('one');
          const summary = getNotes('two');
          const save = update({ source: [notes, summary], action: () => Promise.resolve(1), apply() { return () => {}; } });
          return <div><button onClick={() => save()}>Save</button>{notes.map(note => <p>{note.text}</p>)}</div>;
        }`,
    }, utilsPackageArtifacts);
    expect(output['./App.tsx']).toContain('source: [notes, summary]');
    expect(output['./App.tsx']).toContain('readResolvedValue');
    const shared = compileModules({
      './functions.ts': facade,
      './sources.ts': `import { getNotes } from './functions'; export const notes = getNotes('one');`,
      './App.tsx': `import { notes } from './sources'; import { optimistic } from '@memoized-dom/utils';
        export function App() {
          const save = optimistic({ source: notes, action: () => Promise.resolve(1), apply() { return () => {}; } });
          return <div><button onClick={() => save()}>Save</button>{notes.map(note => <p>{note.text}</p>)}</div>;
        }`,
    }, utilsPackageArtifacts);
    expect(shared['./App.tsx']).toContain('source: notes');
    expect(shared['./App.tsx']).not.toMatch(/source: (?:readResolvedValue|readModuleSource)/);
    expect(() => analyzeServerFunctionModule('export const bad = define.function({ live: () => ["a"], async *get() { yield 1; } });', { moduleId: '/app/server/functions/bad.ts' })).toThrow('ordinary GET');
  });
  it('discovers HTTP verb definitions, aliases, and transported parameters', () => {
    const source = `
      import { define } from '../define';
      import { requireUser } from '../middleware';
      const voteInput = schema();
      export const stories = define.function({ get: async ({ services }, limit: number = 20) => services.database.stories(limit) });
      const save = define.function({
        middleware: [requireUser],
        input: voteInput,
        post: async ({ services }, input) => services.database.vote(input.id),
      });
      export { save as vote };
    `;
    const options = { moduleId: '/app/server/functions/stories.ts' };
    const module = analyzeServerFunctionModule(source, options);
    expect(module.functions).toEqual([
      expect.objectContaining({
        exported: 'stories', method: 'GET',
        schemaInput: false,
        parameters: [{ name: 'limit', optional: true, queryKind: 'number' }],
      }),
      expect.objectContaining({
        exported: 'vote', local: 'save', method: 'POST',
        schemaInput: true,
        parameters: [{ name: 'input', optional: false }],
      }),
    ]);
    expect(generateServerFunctionImplementation(source, options)).toBe(source);
    const client = generateServerFunctionClient(module);
    expect(client).toContain('export function vote(input)');
    expect(client).toContain('body: JSON.stringify(input)');
    expect(client).not.toContain('requireUser');
    expect(client).not.toContain('voteInput');
    expect(client).not.toContain('services');
  });

  it('uses the definition method independently of the export name', () => {
    const module = analyzeServerFunctionModule(`
      export const getAccessToken = define.function({ post: async ({ state }) => state });
    `, { moduleId: '/app/server/functions/auth.ts' });
    expect(module.functions[0]?.method).toBe('POST');
  });

  it('transports the schema input directly even when the handler destructures its output', () => {
    const module = analyzeServerFunctionModule(`
      export const story = define.function({
        input: storySchema,
        get: async (_context, { id }) => ({ id }),
      });
      export const save = define.function({
        input: saveSchema,
        post: async (_context, { title }) => ({ title }),
      });
    `, { moduleId: '/app/server/functions/stories.ts' });
    const client = generateServerFunctionClient(module);
    expect(client).toContain('query: { input: JSON.stringify(input) }');
    expect(client).toContain('body: JSON.stringify(input)');
    expect(() => analyzeServerFunctionModule(`
      export const invalid = define.function({
        input: schema,
        post: async (_context, id, title) => ({ id, title }),
      });
    `, { moduleId: '/app/server/functions/invalid.ts' }))
      .toThrow('at most one schema-owned input');
  });

  it('discovers endpoints and keeps the module middleware export', () => {
    const module = analyzeServerFunctionModule(`
      export const middleware = [requireAuth()];
      export const getStory = define.function({ get: async ({ services }, id: number, preview = false) => services.database.story(id, preview) });
      const vote = define.function({ post: async ({ services }, id: number) => services.database.vote(id) });
      export { vote as postVote };
    `, { moduleId: 'C:\\app\\server\\functions\\news\\stories.ts' });

    expect(module).toEqual({
      moduleId: 'C:\\app\\server\\functions\\news\\stories.ts',
      moduleName: 'news/stories',
      middlewareExport: true,
      functions: [
        {
          exported: 'getStory', local: 'getStory', method: 'GET',
          path: '/_fn/news/stories/getStory',
          schemaInput: false,
          parameters: [
            { name: 'id', optional: false, queryKind: 'number' },
            { name: 'preview', optional: true, queryKind: 'boolean' },
          ],
        },
        {
          exported: 'postVote', local: 'vote', method: 'POST',
          path: '/_fn/news/stories/postVote',
          schemaInput: false,
          parameters: [{ name: 'id', optional: false }],
        },
      ],
    });
  });

  it('generates a small $fetch-only client facade', () => {
    const module = analyzeServerFunctionModule(`
      export const getStories = define.function({ get: async ({ services }) => services.database.all() });
      export const getStory = define.function({ get: async ({ services }, id: number) => services.database.find(id) });
      export const deleteStory = define.function({ delete: async ({ services }, id: number) => services.database.remove(id) });
    `, { moduleId: '/app/server/functions/stories.ts' });
    const client = generateServerFunctionClient(module);
    expect(client).toContain('return __mmd_fetch("/_fn/stories/getStories")');
    expect(client).toContain('query: { id }');
    expect(client).toContain('method: "DELETE", body: { id }');
    expect(client).not.toContain('services');
  });

  it('generates declarations from definition argument and result types', () => {
    const first = analyzeServerFunctionModule(`
      export const getStory = define.function({ get: async ({ services }, id: number) => services.database.find(id) });
      export const postVote = define.function({ post: async ({ services }, id: number) => services.database.vote(id) });
    `, { moduleId: '/app/server/functions/stories.ts' });
    const declarations = generateServerFunctionDeclarations([first], {
      resolveImplementation: () => '../server/functions/stories.js',
    });
    expect(declarations).toContain(
      'import type { ErrorResponse, JsonResponse, ServerFunctionArguments, ServerFunctionResult } from \'@memoized-dom/server\'',
    );
    expect(declarations).toContain(
      'export declare function getStory(...args: ServerFunctionArguments<typeof __mmd_impl_0.getStory>): ResolvedValue<__mmdClientValue<Awaited<ServerFunctionResult<typeof __mmd_impl_0.getStory>>>>;',
    );
    expect(declarations).toContain(
      'export declare function postVote(...args: ServerFunctionArguments<typeof __mmd_impl_0.postVote>): ResolvedValue<__mmdClientValue<Awaited<ServerFunctionResult<typeof __mmd_impl_0.postVote>>>>;',
    );
    expect(declarations).not.toContain('middleware');
  });

  it('rejects duplicate exported names across the barrel', () => {
    const source = 'export const getStory = define.function({ get: async ({ services }, id: number) => ({ id }) });';
    const first = analyzeServerFunctionModule(source, {
      moduleId: '/app/server/functions/news/stories.ts',
    });
    const second = analyzeServerFunctionModule(source, {
      moduleId: '/app/server/functions/shop/stories.ts',
    });
    expect(() => generateServerFunctionDeclarations([first, second], {
      resolveImplementation: () => './stories.js',
    })).toThrow(/\[MMD-S012\].*news\/stories.*shop\/stories/s);
  });

  it('accepts zero-argument method handlers without transport arguments', () => {
    const module = analyzeServerFunctionModule(`
      export const stories = define.function({
        async get() { return loadStories(); },
      });
    `, { moduleId: '/app/server/functions/stories.ts' });
    expect(module.functions[0]?.parameters).toEqual([]);
    expect(generateServerFunctionClient(module)).toContain('export function stories()');
  });

  it('rejects missing, multiple, hidden, and non-inline HTTP handlers', () => {
    const options = { moduleId: '/app/server/functions/stories.ts' };
    for (const source of [
      'export const story = define.function({});',
      'export const story = define.function({ async get() {}, async post() {} });',
    ]) {
      expect(() => analyzeServerFunctionModule(source, options)).toThrow('exactly one HTTP method');
    }
    expect(() => analyzeServerFunctionModule(
      'export const story = define.function({ get: loadStory });', options,
    )).toThrow('inline handler');
    expect(() => analyzeServerFunctionModule(
      'export const story = define.function({ ...methods });', options,
    )).toThrow('fields must be explicit');
    expect(() => analyzeServerFunctionModule(
      'export const story = define.function.get(async () => 1);', options,
    )).toThrow('created by define.function()');
  });

  it('rejects ordinary exports, sync handlers, and invalid parameters', () => {
    const options = { moduleId: '/app/server/functions/stories.ts' };
    expect(() => analyzeServerFunctionModule(
      'export async function authenticate() {}', options,
    )).toThrow(/created by define\.function/);
    expect(() => analyzeServerFunctionModule(
      'export const getSession = define.function({ get: ({ state }) => state });', options,
    )).toThrow(/handler must be async/);
    expect(() => analyzeServerFunctionModule(
      'export const story = define.function({ post: async ({ state }, { title }: { title: string }) => title });', options,
    )).toThrow(/named identifiers/);
    expect(() => analyzeServerFunctionModule(
      'export const value = define.function({ get: async ({ state }, value: string | number) => value });', options,
    )).toThrow(/parameter 'value'.*query type/s);
    expect(() => analyzeServerFunctionModule(
      'export const databaseForTests = database;', options,
    )).toThrow(/databaseForTests/);
  });

  it('normalizes only modules beneath the configured functions root', () => {
    expect(serverFunctionModuleName('/app/backend/http/users.ts', 'backend/http'))
      .toBe('users');
    expect(() => serverFunctionModuleName('/app/client/users.ts'))
      .toThrow(/outside 'server\/functions\/'/);
  });

  it('rejects non-GET server functions during render but allows handlers', () => {
    const metadata = analyzeServerFunctionModule(`
      export const postVote = define.function({ post: async ({ services }, id: number) => ({ id, votes: 4 }) });
    `, { moduleId: '/app/server/functions/stories.ts' });
    const facade = generateServerFunctionClient(metadata);
    expect(() => compileModules({
      './functions.ts': facade,
      './App.tsx': `
        import { postVote } from './functions';
        export function App() {
          postVote(1);
          return <main>Stories</main>;
        }
      `,
    })).toThrow(/\[MMD-S010\].*postVote.*HTTP POST.*component rendering/s);
    const output = compileModules({
      './functions.ts': facade,
      './App.tsx': `
        import { postVote } from './functions';
        export function App() {
          return <button onClick={() => postVote(1)}>Vote</button>;
        }
      `,
    });
    expect(output['./functions.ts']).toContain('/_fn/stories/postVote');
  });

  it('replays facade calls and resolves event-created values', () => {
    const metadata = analyzeServerFunctionModule(`
      export const getStory = define.function({ get: async ({ services }, id: number) => ({ id }) });
      export const postVote = define.function({ post: async ({ services }, id: number) => ({ id }) });
    `, { moduleId: '/app/server/functions/stories.ts' });
    const facade = generateServerFunctionClient(metadata);
    const output = compileModules({
      './functions.ts': facade,
      './App.tsx': `
        import { $track } from '@memoized-dom/data';
        import { getStory, postVote } from './functions';
        export function App() {
          let selectedId = 1;
          let lastVote: ReturnType<typeof postVote> | null = null;
          $effect(() => console.log(lastVote));
          return <main>
            <button onClick={() => { lastVote = postVote(selectedId); }}>Vote</button>
            <Story id={selectedId} />
            {lastVote !== null && <p>{$track(lastVote).pending ? 'Voting' : lastVote.id}</p>}
          </main>;
        }
        function Story({ id }: { id: number }) {
          const story = getStory(id);
          return <h1>{story.id}</h1>;
        }
      `,
    });
    const compiled = output['./App.tsx']!;
    expect(compiled).toContain('rebindResolvedValueFromFactory(story, () => getStory(id))');
    expect(compiled).toContain('createEventSourceSlot()');
    expect(compiled).toContain('runResolvedValuesEffect([lastVote]');
    expect(compiled).toContain('readResolvedValueForRender(lastVote).id');
  });
});
