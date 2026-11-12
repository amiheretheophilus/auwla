import { describe, expect, it } from 'bun:test';
import type { ProjectHost } from '../project/host';
import { createApplication, GENERATED } from './application';

/** A host over an editable set of files, which lists folders too. */
function memoryHost(files: Record<string, string>): ProjectHost {
  return {
    readFile: (path) => files[path],
    list: (folder) => Object.keys(files).filter((path) => path.startsWith(`${folder}/`)).sort(),
  };
}

const FILES: Record<string, string> = {
  './src/main.ts': `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`,
  './src/App.tsx': `
import { getUser, saveUser } from '#server-functions';
export function App() {
  const user = getUser('1');
  return <main><p>{user.name}</p><button onClick={() => saveUser('Lin')}>save</button></main>;
}
`,
  './server.ts': `
import { createDefine, serve } from '@memoized-dom/server';
import { App } from './src/App';
import { database } from '#server/database';
const app = serve({ define: createDefine(), services: { database } });
app.ssr(App);
export default app;
`,
  './server/database.ts': 'export const database = { users: new Map() };',
  './server/services.ts': `export const mailer = define.service('mailer', () => ({}));`,
  './server/functions/_middleware.ts': 'export const middleware = [];',
  './server/functions/users.ts': `
export const getUser = define.function({ async get({ services }, id: string) { return services.database.users.get(id); } });
export const saveUser = define.function({ async post({ services }, name) { return { name }; } });
`,
};

describe('applications', () => {
  it('build the client with facades, never the server code', async () => {
    const build = await createApplication({ client: './src/main.ts', server: './server.ts', host: memoryHost(FILES) }).build();
    expect(build.client.ok).toBe(true);
    if (!build.client.ok) return;

    const modules = [...build.client.modules].sort();
    expect(modules).toContain(GENERATED.barrel);
    expect(modules).toContain('./.memoized/functions/users.ts');
    expect(modules.some((path) => path.startsWith('./server'))).toBe(false);
    expect(build.client.output['./.memoized/functions/users.ts']).toContain('"/_fn/users/getUser"');
    expect(build.client.output['./.memoized/functions/users.ts']).not.toContain('services.database');
    // With a server, the client adopts its markup.
    expect(build.client.output['./src/main.ts']).toContain('@memoized-dom/runtime/hydrate');
  });

  it('build the server with its routes, handlers and the delivery it is given', async () => {
    const application = createApplication({ client: './src/main.ts', server: './server.ts', host: memoryHost(FILES), delivery: './delivery.ts' });
    const build = await application.build();
    expect(build.server?.ok).toBe(true);
    if (build.server?.ok !== true) return;

    const modules = [...build.server.modules].sort();
    expect(modules).toEqual(expect.arrayContaining([
      GENERATED.server, GENERATED.registry, './server/database.ts', './server/functions/users.ts',
      './server/functions/_middleware.ts', './server/services.ts', './src/App.tsx',
    ]));
    const registry = build.server.output[GENERATED.registry]!;
    expect(registry).toContain('"/_fn/users/saveUser"');
    expect(registry).toContain('/_memoized/routed');
    // Resolved imports are printed as the modules they name, so a bundler needs no aliases.
    expect(build.server.output['./server.ts']).toContain('from "./.memoized/server-application.ts"');
    expect(build.server.output['./server.ts']).toContain('from "./server/database.ts"');
    expect(build.server.output[GENERATED.server]).toContain('from "../delivery.ts"');
    expect(build.declarations).toContain('export declare function getUser');
  });

  it('build a client-only application without hydration or server code', async () => {
    const files = { './src/main.ts': FILES['./src/main.ts']!, './src/App.tsx': 'export function App() { return <p>hi</p>; }' };
    const build = await createApplication({ client: './src/main.ts', host: memoryHost(files) }).build();
    expect(build.server).toBeUndefined();
    expect(build.client.ok && build.client.output['./src/main.ts']).not.toContain('hydrate');
    expect(build.declarations).toBeNull();
  });

  it('report a server-only import in client code', async () => {
    const files = { ...FILES, './src/App.tsx': `import { database } from '#server/database';\nexport function App() { return <p>{database.users.size}</p>; }` };
    const build = await createApplication({ client: './src/main.ts', server: './server.ts', host: memoryHost(files) }).build();
    expect(!build.client.ok && build.client.error.message).toContain("'#server/database' is server-only");
  });

  it('let a server-backed $routed callback read server-only code, dropped from the client', async () => {
    const files = {
      ...FILES,
      './src/App.tsx': `
import { database } from '#server/database';
function Story() {
  const story = $routed(({ params, services }) => database.users.get(params.id));
  return <p>{story}</p>;
}
export function App() { return <main><Story route="/story/:id" /></main>; }
`,
    };
    const build = await createApplication({ client: './src/main.ts', server: './server.ts', host: memoryHost(files) }).build();
    expect(build.client.ok).toBe(true);
    expect(build.server?.ok).toBe(true);
    expect(build.client.ok && build.client.output['./src/App.tsx']).not.toContain('server/database');
    // On the server, `#server/database` is printed as the module it resolves to.
    expect(build.server?.ok && build.server.output['./src/App.tsx']).toContain('from "../server/database.ts"');
  });

  it('report a server function error with its module', async () => {
    const files = { ...FILES, './server/functions/bad.ts': 'export const helper = 1;' };
    const build = await createApplication({ client: './src/main.ts', server: './server.ts', host: memoryHost(files) }).build();
    expect(!build.client.ok && build.client.error.path).toBe('./server/functions/bad.ts');
  });

  it('update both builds when a server function changes, naming what changed in each', async () => {
    const files = { ...FILES };
    const application = createApplication({ client: './src/main.ts', server: './server.ts', host: memoryHost(files) });
    await application.build();

    files['./server/functions/users.ts'] = FILES['./server/functions/users.ts']!.replace("id: string", "id: string, full = false");
    const update = await application.update(['./server/functions/users.ts']);
    expect(update.client.changed).toContain('./.memoized/functions/users.ts');
    expect(update.server?.changed).toEqual(expect.arrayContaining(['./server/functions/users.ts', GENERATED.registry]));
  });
});
