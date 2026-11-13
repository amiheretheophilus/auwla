import { describe, expect, it } from 'bun:test';
import type { SourceLanguage } from '../core/parse/languages';
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

/** The server, and the folder it says is server-only. */
const SERVER = { entry: './server.ts', folder: './server' };

describe('applications', () => {
  it('treat no folder as server-only until told which one is', async () => {
    const build = await createApplication({ client: './src/main.ts', server: { entry: './server.ts' }, host: memoryHost(FILES) }).build();
    // No functions are looked for, so `#server-functions` has nothing; `#server/` names nothing.
    expect(build.functions).toEqual([]);
    expect(!build.server?.ok && build.server?.error.message).toContain("'#server/database' needs the server folder: declare it as server.folder");
  });

  it('read server functions from another folder when told to', async () => {
    const files = Object.fromEntries(Object.entries(FILES).map(([path, text]) => [path.replace('./server/functions/', './api/'), text]));
    const build = await createApplication({
      client: './src/main.ts', server: { ...SERVER, functions: './api' }, host: memoryHost(files),
    }).build();
    expect(build.functions.map((module) => module.moduleName)).toEqual(['users']);
    expect(build.server?.ok && build.server.output['./.memoized/server-functions.server.ts']).toContain('"/_fn/users/getUser"');
  });

  it('build the client with facades, never the server code', async () => {
    const build = await createApplication({ client: './src/main.ts', server: SERVER, host: memoryHost(FILES) }).build();
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
    const application = createApplication({ client: './src/main.ts', server: { ...SERVER, delivery: './delivery.ts' }, host: memoryHost(FILES) });
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
    // The entry's top-level code runs once and needs no reactive machinery. (The wrapper's
    // integration object, and through it the routes, keep readers: `serve()` reads it inside a
    // function, which a component could call as far as the compiler knows.)
    expect(build.server.output['./server.ts']).not.toContain('_read_');
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
    const build = await createApplication({ client: './src/main.ts', server: SERVER, host: memoryHost(files) }).build();
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
    const build = await createApplication({ client: './src/main.ts', server: SERVER, host: memoryHost(files) }).build();
    expect(build.client.ok).toBe(true);
    expect(build.server?.ok).toBe(true);
    expect(build.client.ok && build.client.output['./src/App.tsx']).not.toContain('server/database');
    // On the server, `#server/database` is printed as the module it resolves to.
    expect(build.server?.ok && build.server.output['./src/App.tsx']).toContain('from "../server/database.ts"');
  });

  it('report a server function error with its module', async () => {
    const files = { ...FILES, './server/functions/bad.ts': 'export const helper = 1;' };
    const build = await createApplication({ client: './src/main.ts', server: SERVER, host: memoryHost(files) }).build();
    expect(!build.client.ok && build.client.error.path).toBe('./server/functions/bad.ts');
  });

  it('compile server-only code as plain code, while pages rendered on the server keep their machinery', async () => {
    // A store edited by a server function and read by another: in a component it would be state.
    const files = {
      ...FILES,
      './server/store.ts': `const users: { name: string }[] = [];\nexport function add(name: string) { users.push({ name }); return users.length; }\nexport function all() { return users; }\n`,
      './server/functions/users.ts': `
import { add, all } from '../store';
export const getUser = define.function({ async get({ services }, id: string) { return all()[Number(id)]; } });
export const saveUser = define.function({ async post({ services }, name) { const count = add(name); try { return { count }; } finally { await Promise.resolve(); } } });
`,
    };
    const build = await createApplication({ client: './src/main.ts', server: SERVER, host: memoryHost(files) }).build();
    expect(build.server?.ok).toBe(true);
    if (build.server?.ok !== true) return;
    const machinery = /_MD\.|_data\.|_read_|_mutated_|_sourceStep/;
    // The folder, the entry, and the generated routes and `serve()` wrapper.
    for (const path of ['./server/store.ts', './server/functions/users.ts', './server/database.ts', './server.ts', GENERATED.registry, GENERATED.server]) {
      const code = build.server.output[path]!;
      // The entry hands `App` to `ssr` as a component value; nothing else of the runtime remains.
      expect([path, machinery.test(code.replaceAll('_MD.componentValue(App)', 'App'))]).toEqual([path, false]);
    }
    expect(build.server.output['./server/store.ts']).toContain('users.push({ name });');
    // The page still waits for `getUser`, in the server build as in the client's.
    expect(build.server.output['./src/App.tsx']).toContain('_data.');
    expect(build.client.ok && build.client.output['./src/App.tsx']).toContain('_data.');
  });

  it('read server code a source language owns like .ts: functions, services and #server/ modules', async () => {
    // `.toy` is TSX after a `// toy` line the author did not write: the TSX's offsets are all
    // one line below the authored ones. The compiler must know no particular language.
    const HEADER = '// written by the toy language\n';
    const toy: SourceLanguage = {
      extensions: ['.toy'],
      toTsx: (text) => ({ code: HEADER + text, origin: { original: (offset) => Math.max(0, offset - HEADER.length) } }),
    };
    // The same application, with its server modules (not `_middleware.ts`) written in `.toy`.
    const asToy = new Set(['./server/database.ts', './server/services.ts', './server/functions/users.ts']);
    const files = Object.fromEntries(Object.entries(FILES).map(([path, text]) => [asToy.has(path) ? path.replace(/\.ts$/, '.toy') : path, text]));

    const build = await createApplication({ client: './src/main.ts', server: SERVER, host: memoryHost(files), languages: [toy] }).build();
    expect(build.client.ok && build.server?.ok).toBe(true);
    if (!build.client.ok || build.server?.ok !== true) return;
    // The endpoint is named without the language's extension, and the facade is plain `.ts`.
    expect(build.functions.map((module) => module.moduleName)).toEqual(['users']);
    expect(build.client.output['./.memoized/functions/users.ts']).toContain('"/_fn/users/getUser"');
    expect(build.client.output[GENERATED.barrel]).toContain('./functions/users.ts');
    const registry = build.server.output[GENERATED.registry]!;
    expect(registry).toContain('from "../server/functions/users.toy"');
    expect(registry).toContain('import "../server/services.toy"');
    // `#server/database` found the `.toy` module, as a relative import would.
    expect(build.server.output['./server.ts']).toContain('from "./server/database.toy"');

    // An error in a language's server function is at its authored line, not the TSX's.
    const broken = { ...files, './server/functions/users.toy': 'export const helper = 1;' };
    const failed = await createApplication({ client: './src/main.ts', server: SERVER, host: memoryHost(broken), languages: [toy] }).build();
    expect(!failed.client.ok && { path: failed.client.error.path, line: failed.client.error.line }).toEqual({
      path: './server/functions/users.toy', line: 1,
    });
  });

  it('update both builds when a server function changes, naming what changed in each', async () => {
    const files = { ...FILES };
    const application = createApplication({ client: './src/main.ts', server: SERVER, host: memoryHost(files) });
    await application.build();

    files['./server/functions/users.ts'] = FILES['./server/functions/users.ts']!.replace("id: string", "id: string, full = false");
    const update = await application.update(['./server/functions/users.ts']);
    expect(update.client.changed).toContain('./.memoized/functions/users.ts');
    expect(update.server?.changed).toEqual(expect.arrayContaining(['./server/functions/users.ts', GENERATED.registry]));
  });
});
