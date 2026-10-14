import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { analyzeServerFunctionModule, parseWithEstreeFrontendOrThrow, memoizedEstreeFrontend } from '@memoized-dom/compiler';
import { resolveAdapterOptions } from '../src/options';
import {
  generateServerFunctionRoutesModule,
  rewriteServerFunctionBarrelImports,
  serverFunctionsDeclarationFile,
  writeServerFunctionDeclarations,
} from '../src/server-functions';
import { routesDeclarationFile, writeRoutesDeclaration } from '../src/routes';

let fixture: string | undefined;
afterEach(async () => {
  if (fixture !== undefined) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
});

describe('server function barrel imports', () => {
  it('rewrites AST specifiers while preserving aliases, types, comments, and unrelated strings', () => {
    const source = `
      const example = "import { story } from '#server-functions'";
      import {
        /* Stories, including drafts */
        story /* alias, comment */ as selected,
        type Story,
        vote,
        unknown,
      } from '#server-functions';
      import type { User } from '#server-functions';
    `;
    const output = rewriteServerFunctionBarrelImports(source, [
      { exported: 'story', specifier: '/server/functions/stories.ts' },
      { exported: 'vote', specifier: '/server/functions/votes.ts' },
    ]);
    expect(output).toContain('/* Stories, including drafts */');
    expect(output).toContain('story /* alias, comment */ as selected');
    expect(output).toContain('import { type Story, unknown } from "#server-functions"');
    expect(output).toContain('import type { User } from \'#server-functions\'');
    expect(output).toContain('const example = "import { story } from \'#server-functions\'"');
    const program = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, output, { filename: 'app.ts' }).program;
    expect(program.body.filter(node => node.type === 'ImportDeclaration')).toHaveLength(4);
  });

  it('retains mixed default imports and leaves namespace imports alone', () => {
    const output = rewriteServerFunctionBarrelImports(`
      import fallback, { story as selected } from '#server-functions';
      import * as functions from '#server-functions';
    `, [{ exported: 'story', specifier: '/stories.ts' }]);
    expect(output).toContain('import fallback from "#server-functions"');
    expect(output).toContain('import { story as selected } from "/stories.ts"');
    expect(output).toContain("import * as functions from '#server-functions'");
  });
});

describe('conditional generated declarations', () => {
  it('creates no declaration files or directory when functions and routes are absent', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-declarations-'));
    await writeServerFunctionDeclarations(fixture, [], resolveAdapterOptions({ clientEntry: 'main.ts' }));
    await writeRoutesDeclaration(fixture, []);
    await expect(stat(resolve(fixture, '.memoized'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes stale declarations when their last function or route disappears', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-declarations-'));
    const options = resolveAdapterOptions({ clientEntry: 'main.ts' });
    const module = analyzeServerFunctionModule(
      'export const story = define.function({ get: async ({ state }) => state });', {
      moduleId: resolve(fixture, 'server/functions/stories.ts'),
    });
    await writeServerFunctionDeclarations(fixture, [module], options);
    await writeRoutesDeclaration(fixture, ['/stories/:id']);
    expect(await readFile(serverFunctionsDeclarationFile(fixture), 'utf8')).toContain('function story');
    expect(await readFile(routesDeclarationFile(fixture), 'utf8')).toContain('/stories/:id');
    await Promise.all([
      writeServerFunctionDeclarations(fixture, [], options),
      writeServerFunctionDeclarations(fixture, [], options),
      writeRoutesDeclaration(fixture, []),
      writeRoutesDeclaration(fixture, []),
    ]);
    await expect(stat(serverFunctionsDeclarationFile(fixture))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(routesDeclarationFile(fixture))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('server service discovery', () => {
  it('imports exported define services and reports their resolved names', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-services-'));
    const server = resolve(fixture, 'server');
    await mkdir(server, { recursive: true });
    const servicesFile = resolve(server, 'services.ts');
    await writeFile(servicesFile, `
      import { define } from './define';
      export const database = define.service('database', async () => ({ ready: true }));
    `);
    const generated = await generateServerFunctionRoutesModule(
      fixture,
      resolveAdapterOptions({ clientEntry: 'main.ts' }),
    );
    expect(generated.services).toEqual([{
      file: servicesFile.replaceAll('\\', '/'),
      exported: 'database',
      name: 'database',
    }]);
    expect(generated.source).toContain(
      `import ${JSON.stringify(servicesFile.replaceAll('\\', '/'))};`,
    );
  });

  it('rejects duplicate service names across modules', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-services-'));
    const server = resolve(fixture, 'server');
    await mkdir(server, { recursive: true });
    await Promise.all([
      writeFile(resolve(server, 'one.ts'),
        `export const one = define.service('database', () => ({}));`),
      writeFile(resolve(server, 'two.ts'),
        `export const two = define.service('database', () => ({}));`),
    ]);
    await expect(generateServerFunctionRoutesModule(
      fixture,
      resolveAdapterOptions({ clientEntry: 'main.ts' }),
    )).rejects.toThrow("service 'database' is exported by both");
  });
});
