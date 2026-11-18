import { waitFor } from '../../../test-support/helpers';
/**
 * Exercises the Vite 8 adapter through Rolldown build and dev transforms.
 */
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  build,
  createBuilder,
  createServer,
  type ViteDevServer,
} from 'vite';
import memoizedDom from '../src';
import { createDevServer, type NativeDevServer } from '../src/dev';

const fixture = resolve(import.meta.dirname, 'fixtures/vite-app');
const source = resolve(fixture, 'src');
const runtime = resolve(import.meta.dirname, '../../runtime/src/index.ts');
const runtimeHot = resolve(import.meta.dirname, '../../runtime/src/hot.ts');
const runtimeServer = resolve(import.meta.dirname, '../../runtime/src/server.ts');
const routerInternal = resolve(import.meta.dirname, '../../router/src/internal.ts');
const data = resolve(import.meta.dirname, '../../data/src/index.ts');
const dataInternal = resolve(import.meta.dirname, '../../data/src/internal.ts');
const serverRouter = resolve(import.meta.dirname, '../../server/src/http-router.ts');
const serverIndex = resolve(import.meta.dirname, '../../server/src/index.ts');
let server: ViteDevServer | undefined;
let nativeServer: NativeDevServer | undefined;
let temporaryFixture: string | undefined;

function plugins() {
  return [
    memoizedDom({
      clientEntry: 'src/main.ts',
    }),
  ];
}

afterEach(async () => {
  await nativeServer?.close();
  nativeServer = undefined;
  await server?.close();
  server = undefined;
  if (temporaryFixture !== undefined) {
    await rm(temporaryFixture, { recursive: true, force: true });
    temporaryFixture = undefined;
  }
});

/** A copy of the fixture inside the package, so a built server finds the workspace's packages. */
async function copyFixture(): Promise<string> {
  temporaryFixture = await mkdtemp(join(import.meta.dirname, '../.vite-adapter-test-'));
  await cp(fixture, temporaryFixture, { recursive: true });
  return temporaryFixture;
}

/** The server folder of a copy: `define.ts`, and a `functions` folder with `stories.ts`. */
async function writeStoryFunctions(root: string, stories: string): Promise<void> {
  const functions = resolve(root, 'server/functions');
  await mkdir(functions, { recursive: true });
  await writeFile(resolve(root, 'server/define.ts'), `
    import { createDefine } from '@memoized-dom/server';
    export const define = createDefine();
  `);
  await writeFile(resolve(functions, 'stories.ts'), stories);
}

describe('Vite 8 adapter', () => {
  it('does not generate unused server-function or route declarations for a browser-only app', async () => {
    const root = await copyFixture();
    server = await createServer({
      root, configFile: false, logLevel: 'silent',
      resolve: { alias: {
        '@': resolve(root, 'src'),
        '@memoized-dom/runtime/hot': runtimeHot,
        '@memoized-dom/runtime': runtime,
      } },
      plugins: plugins(),
      server: { middlewareMode: true },
    });
    await server.transformRequest('/src/main.ts');
    await expect(readFile(resolve(root, '.memoized/server-functions.d.ts'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(resolve(root, '.memoized/routes.d.ts'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps stateful package subpaths in one browser module graph', async () => {
    server = await createServer({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      plugins: plugins(),
    });

    expect(server.config.optimizeDeps.exclude).toEqual(expect.arrayContaining([
      '@memoized-dom/runtime',
      '@memoized-dom/data',
      '@memoized-dom/router',
    ]));
  });

  it('keeps server function implementations out of the client, and runs their middleware and input checks in the built server', async () => {
    const root = await copyFixture();
    await writeStoryFunctions(root, `
      import { readFile } from 'node:fs/promises';
      import { define } from '../define';
      const SERVER_SECRET = 'must-not-enter-client';
      export const middleware = [async (_context, next) => {
        const response = await next();
        response.headers.set('x-module', SERVER_SECRET);
        return response;
      }];
      const functionGuard = async (_context, next) => {
        const response = await next();
        response.headers.set('x-function', 'yes');
        return response;
      };
      const storyInput = {
        '~standard': {
          version: 1, vendor: 'test',
          validate(value) {
            const id = Number(value.id);
            return id > 0 ? { value: { id } } : { issues: [{ message: 'Positive ID required' }] };
          },
        },
      };
      export const story = define.function({
        middleware: [functionGuard],
        input: storyInput,
        async get(_context, input) {
          if (false) await readFile('secret');
          return { id: input.id, title: 'Story ' + input.id };
        },
      });
      export const vote = define.function({ post: async (_context, id: number) => ({ id, votes: 1 }) });
    `);
    await writeFile(resolve(root, 'server/functions/_middleware.ts'), `
      export const middleware = [async (_context, next) => {
        const response = await next();
        response.headers.set('x-directory', 'yes');
        return response;
      }];
    `);
    await writeFile(resolve(root, 'src/App.tsx'), `
      import { vote } from '#server-functions';
      export function App() {
        return <main><button onClick={() => vote(7)}>Vote</button></main>;
      }
    `);
    await writeFile(resolve(root, 'src/server.ts'), `
      import { serve } from '@memoized-dom/server';
      import { define } from '#server/define';
      export default serve({ define });
    `);
    await writeFile(resolve(root, 'index.html'), '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>');

    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'src/server.ts', server: 'server' })],
    });
    await builder.buildApp();

    // The client calls the function by its route, and has none of its implementation.
    const assets = resolve(root, 'dist/client/assets');
    const scripts = (await readdir(assets)).filter((file) => file.endsWith('.js'));
    const client = (await Promise.all(scripts.map((file) => readFile(resolve(assets, file), 'utf8')))).join('\n');
    expect(client).toContain('/_fn/stories/vote');
    expect(client).not.toContain('must-not-enter-client');
    expect(client).not.toContain('Positive ID required');
    expect(client).not.toContain('functionGuard');
    expect(client).not.toContain('node:fs/promises');

    // TypeScript's types for `#server-functions`, from the implementations.
    const declarations = await readFile(resolve(root, '.memoized', 'server-functions.d.ts'), 'utf8');
    expect(declarations).toContain('story');
    expect(declarations).toContain('vote');

    // The folder's, the module's and the function's middleware run around the function.
    const { default: host } = await import(pathToFileURL(resolve(root, 'dist', 'server.js')).href) as {
      default: { fetch(request: Request): Promise<Response> };
    };
    const response = await host.fetch(new Request(
      'https://app.test/_fn/stories/story?input=' + encodeURIComponent(JSON.stringify({ id: 9 })),
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-directory')).toBe('yes');
    expect(response.headers.get('x-function')).toBe('yes');
    expect(response.headers.get('x-module')).toBe('must-not-enter-client');
    await expect(response.json()).resolves.toEqual({ id: 9, title: 'Story 9' });

    // Input the function's schema rejects never reaches it.
    const invalidInput = await host.fetch(new Request('https://app.test/_fn/stories/story?input=' + encodeURIComponent(JSON.stringify({ id: -1 }))));
    expect(invalidInput.status).toBe(400);
    expect(await invalidInput.json()).toMatchObject({ issues: [{ message: 'Positive ID required' }] });
  }, 60_000);

  it('rejects direct UI imports from server-function implementation files', async () => {
    const root = await copyFixture();
    await writeStoryFunctions(root, `
      import { define } from '../define';
      export const getStories = define.function({ get: async (_context) => [] });
    `);
    await writeFile(resolve(root, 'src/App.tsx'), `
      import { getStories } from '../server/functions/stories';
      export function App() {
        const stories = getStories();
        return <main>{stories.length}</main>;
      }
    `);

    await expect(build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [memoizedDom({ clientEntry: 'src/main.ts', serverEntry: 'src/server.ts', server: 'server' })],
      build: { write: false, minify: false, rolldownOptions: { input: resolve(root, 'src/main.ts') } },
    })).rejects.toThrow(/server-only/);
  }, 30_000);

  it('rejects runtime #server imports from the client graph', async () => {
    const root = await copyFixture();
    const temporarySource = resolve(root, 'src');
    const serverDirectory = resolve(root, 'server');
    await mkdir(serverDirectory, { recursive: true });
    await writeFile(resolve(serverDirectory, 'database.ts'), `
      export const database = { secret: 'must-not-enter-client' };
    `);
    await writeFile(resolve(temporarySource, 'App.tsx'), `
      import { database } from '#server/database';
      export function App() {
        return <main>{database.secret}</main>;
      }
    `);

    await expect(build({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: {
          '@': temporarySource,
          '@memoized-dom/runtime': runtime,
          '@memoized-dom/data/internal': dataInternal,
          '@memoized-dom/data': data,
        },
      },
      plugins: [memoizedDom({
        clientEntry: 'src/main.ts',
        server: 'server',
      })],
      build: {
        write: false,
        minify: false,
        rolldownOptions: { input: resolve(temporarySource, 'main.ts') },
      },
    })).rejects.toThrow(/'#server\/database' is server-only/);
  }, 30_000);

  it('maps a dev module back to its authored file, which the browser finds beside it', async () => {
    server = await createServer({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': source } },
      plugins: plugins(),
      server: { middlewareMode: true },
    });

    await server.environments.client.transformRequest('/src/main.ts');
    const app = await server.environments.client.transformRequest('/src/App.tsx');
    expect(app?.map).not.toBeNull();
    // A source resolves against the module's own URL (`/src/App.tsx`): `./src/App.tsx` would name
    // `/src/src/App.tsx`.
    expect(app?.map?.sources).toEqual(['App.tsx']);
    expect(app?.map?.sourcesContent?.some((content) => content?.includes('export function App()'))).toBe(true);
  });

  it('keeps a route-only component out of the entry chunk', async () => {
    const root = await copyFixture();
    const temporarySource = resolve(root, 'src');
    await writeFile(resolve(temporarySource, 'main.ts'), `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './App';
      mount('root', App);
    `);
    await writeFile(resolve(temporarySource, 'App.tsx'), `
      import { Detail } from './Detail';
      export function App() {
        return <main route="/"><Detail route="/detail" /></main>;
      }
    `);
    await writeFile(resolve(temporarySource, 'Detail.tsx'), `
      import './Detail.css';
      export function Detail() { return <p>route-only-detail-marker</p>; }
    `);
    await writeFile(resolve(temporarySource, 'Detail.css'), `
      p { color: rgb(42, 51, 62); }
    `);

    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: {
        '@memoized-dom/runtime': runtime,
        '@memoized-dom/router/internal': routerInternal,
      } },
      plugins: [memoizedDom({ clientEntry: 'src/main.ts' })],
      build: {
        write: false,
        minify: false,
        rolldownOptions: { input: resolve(temporarySource, 'main.ts') },
      },
    });
    const chunks = (Array.isArray(result) ? result : [result])
      .flatMap(item => item.output)
      .filter(output => output.type === 'chunk');
    const entry = chunks.find(chunk => chunk.isEntry);
    const detail = chunks.find(chunk => chunk.code.includes('route-only-detail-marker'));
    expect(entry).toBeDefined();
    expect(detail).toBeDefined();
    expect(detail?.fileName).not.toBe(entry?.fileName);
    expect(entry?.code).not.toContain('route-only-detail-marker');
    expect(entry?.dynamicImports).toContain(detail?.fileName);
    const routeCss = (Array.isArray(result) ? result : [result])
      .flatMap(item => item.output)
      .filter(output => output.type === 'asset' &&
        output.fileName.endsWith('.css'));
    expect(routeCss).toHaveLength(1);
    expect(detail?.viteMetadata?.importedCss).toContain(routeCss[0]?.fileName);
    expect(entry?.viteMetadata?.importedCss).not.toContain(routeCss[0]?.fileName);
  });

  it('does not emit a lazy route edge into an already eager module', async () => {
    const root = await copyFixture();
    const temporarySource = resolve(root, 'src');
    await writeFile(resolve(temporarySource, 'main.ts'), `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './App';
      mount('root', App);
    `);
    await writeFile(resolve(temporarySource, 'App.tsx'), `
      import { Detail, Badge } from './Detail';
      export function App() {
        return <main route="/"><Badge /><Detail route="/detail" /></main>;
      }
    `);
    await writeFile(resolve(temporarySource, 'Detail.tsx'), `
      export function Badge() { return <span>badge-marker</span>; }
      export function Detail() { return <p>shared-module-detail-marker</p>; }
    `);

    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: {
        '@memoized-dom/runtime': runtime,
        '@memoized-dom/router/internal': routerInternal,
      } },
      plugins: [memoizedDom({ clientEntry: 'src/main.ts' })],
      build: {
        write: false,
        minify: false,
        rolldownOptions: { input: resolve(temporarySource, 'main.ts') },
      },
    });
    const chunks = (Array.isArray(result) ? result : [result])
      .flatMap(item => item.output)
      .filter(output => output.type === 'chunk');
    const entry = chunks.find(chunk => chunk.isEntry);
    expect(entry?.code).toContain('shared-module-detail-marker');
    expect(entry?.dynamicImports).toEqual([]);
  });

  // Was a TSRX component's own style block; TSRX is not the compiler's (`wiki/decisions.md`), so
  // the route's component imports its stylesheet.
  it('keeps a lazy route\'s CSS with its chunk', async () => {
    const root = await copyFixture();
    const temporarySource = resolve(root, 'src');
    await writeFile(resolve(temporarySource, 'main.ts'), `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './App';
      mount('root', App);
    `);
    await writeFile(resolve(temporarySource, 'App.tsx'), `
      import { Detail } from './Detail';
      export function App() { return <main route="/"><Detail route="/detail" /></main>; }
    `);
    await writeFile(resolve(temporarySource, 'detail.css'), '.detail-route { color: rgb(7, 8, 9); }');
    await writeFile(resolve(temporarySource, 'Detail.tsx'), `
      import './detail.css';
      export function Detail() { return <section class="detail-route">Lazy detail</section>; }
    `);
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: {
        '@memoized-dom/runtime': runtime,
        '@memoized-dom/router/internal': routerInternal,
      } },
      plugins: [memoizedDom({ clientEntry: 'src/main.ts' })],
      build: {
        write: false,
        minify: false,
        rolldownOptions: { input: resolve(temporarySource, 'main.ts') },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result])
      .flatMap(item => item.output);
    const chunks = outputs.filter(output => output.type === 'chunk');
    const entry = chunks.find(chunk => chunk.isEntry);
    const detail = chunks.find(chunk => chunk.code.includes('Lazy detail'));
    const css = outputs.filter(output => output.type === 'asset' &&
      output.fileName.endsWith('.css'));
    expect(detail).toBeDefined();
    expect(css).toHaveLength(1);
    expect(detail?.viteMetadata?.importedCss).toContain(css[0]?.fileName);
    expect(entry?.viteMetadata?.importedCss).not.toContain(css[0]?.fileName);
  });

  // The compiler builds the program from its entries (`wiki/compiler/project.md`), so with none
  // there is nothing to serve. A module must not reach the browser uncompiled, where Vite's own
  // JSX transform would ask for React.
  it('reports a client entry with no file instead of serving uncompiled modules', async () => {
    server = await createServer({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': source } },
      plugins: [memoizedDom({ clientEntry: 'src/missing.ts' })],
      server: { middlewareMode: true },
    });

    await expect(server.environments.client.transformRequest('/src/App.tsx'))
      .rejects.toThrow(/no file at this entry/);
  });

  it('recompiles edits and emits an HMR update without a page reload', async () => {
    const root = await copyFixture();
    const temporarySource = resolve(root, 'src');
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: {
        alias: {
          '@': temporarySource,
          '@memoized-dom/runtime/hot': runtimeHot,
          '@memoized-dom/runtime': runtime,
        },
      },
      plugins: plugins(),
      server: { middlewareMode: true },
    });
    await server.environments.client.transformRequest('/src/App.tsx');

    const hot = server.environments.client.hot;
    const send = vi.spyOn(hot, 'send').mockImplementation(() => {});
    const appFile = resolve(temporarySource, 'App.tsx');
    const app = await readFile(appFile, 'utf8');
    await writeFile(appFile, app.replace('Increment</button>', 'Increase</button>'));

    await waitFor(
      () => {
        expect(send).toHaveBeenCalled();
      },
      { timeout: 15_000 },
    );
    expect(send.mock.calls.some(([payload]) => payload.type === 'full-reload'))
      .toBe(false);
    expect(send.mock.calls.some(([payload]) => payload.type === 'update'))
      .toBe(true);
  }, 30_000);

  it('serves Web handlers through the native fullstack launcher', async () => {
    nativeServer = await createDevServer({
      root: fixture,
      configFile: false,
      appType: 'custom',
      logLevel: 'silent',
      plugins: [memoizedDom({
        clientEntry: 'src/main.ts',
        serverEntry: 'src/server.ts',
      })],
      server: {
        host: '127.0.0.1',
        port: 0,
      },
    });
    const origin = nativeServer.origin;

    const health = await fetch(`${origin}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });

    const document = await fetch(`${origin}/`);
    const documentText = await document.text();
    expect(document.status, documentText).toBe(200);
    expect(document.headers.get('content-type'), documentText)
      .toContain('text/html');
    expect(documentText).toBe('<!doctype html><h1>Fullstack</h1>');
  });

  it('auto-installs generated server functions into serve during development', async () => {
    const root = await copyFixture();
    await writeStoryFunctions(root, `
      import { define } from '../define';
      export const getStory = define.function({ get: async (_context, id: number) => {
        return { id, title: 'Story ' + id };
      } });
    `);
    await writeFile(resolve(root, 'src/server.ts'), `
      import { serve } from '@memoized-dom/server';
      import { define } from '../server/define';
      const app = serve({ define });
      app.get('/health', () => ({ ok: true }));
      export default app;
    `);

    nativeServer = await createDevServer({
      root,
      configFile: false,
      appType: 'custom',
      logLevel: 'silent',
      resolve: {
        alias: {
          '@memoized-dom/server/router': serverRouter,
          '@memoized-dom/server': serverIndex,
          '@memoized-dom/runtime/server': runtimeServer,
          '@memoized-dom/runtime': runtime,
          '@memoized-dom/data/internal': dataInternal,
          '@memoized-dom/data': data,
        },
      },
      plugins: [memoizedDom({
        clientEntry: 'src/main.ts',
        serverEntry: 'src/server.ts',
        server: 'server',
      })],
      server: { host: '127.0.0.1', port: 0 },
    });
    const origin = nativeServer.origin;

    const response = await fetch(
      `${origin}/_fn/stories/getStory?id=11`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 11,
      title: 'Story 11',
    });
  }, 30_000);

  it('leaves ordinary server implementation modules outside UI compilation', async () => {
    const root = await copyFixture();
    const serverDirectory = resolve(root, 'server');
    await mkdir(serverDirectory, { recursive: true });
    await writeFile(resolve(serverDirectory, 'db.ts'), `
      let client: { url: string } | null = null;
      const store = (() => {
        client = { url: 'memory://local' };
        return client;
      })();
      export const databaseUrl = store.url;
    `);
    await writeFile(resolve(root, 'src/server.ts'), `
      import { serve } from '@memoized-dom/server';
      import { databaseUrl } from '#server/db';
      import { createDefine } from '@memoized-dom/server';
      const app = serve({ define: createDefine() });
      app.get('/health', () => ({ ok: true, databaseUrl }));
      export default app;
    `);

    nativeServer = await createDevServer({
      root,
      configFile: false,
      appType: 'custom',
      logLevel: 'silent',
      resolve: {
        alias: {
          '@memoized-dom/server/router': serverRouter,
          '@memoized-dom/server': serverIndex,
          '@memoized-dom/runtime/server': runtimeServer,
          '@memoized-dom/runtime': runtime,
          '@memoized-dom/data/internal': dataInternal,
          '@memoized-dom/data': data,
        },
      },
      plugins: [memoizedDom({
        clientEntry: 'src/main.ts',
        serverEntry: 'src/server.ts',
        server: 'server',
      })],
      server: { host: '127.0.0.1', port: 0 },
    });
    const origin = nativeServer.origin;

    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      databaseUrl: 'memory://local',
    });
  }, 30_000);

});
